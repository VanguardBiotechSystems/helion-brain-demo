import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getProfileById } from "@/lib/server/profiles";
import { createRealtimeClientSecret } from "@/lib/server/realtime";
import { buildSessionMemoryContext, getMemoryStore, getMemoryHealth } from "@/lib/server/memory/service";
import { buildSelfKnowledgeBlock } from "@/lib/server/memory/selfKnowledge";
import { clientIpFrom, enforceRateLimit } from "@/lib/server/rateLimit";
import { logError } from "@/lib/server/log";
import { captureError, captureMessage } from "@/lib/server/observability";
import { decideCostAction } from "@/lib/server/costControl";
import { recordSessionStarted, sessionsStartedToday } from "@/lib/server/telemetryStore";
import { ERROR_COPY } from "@/lib/shared/errors";

export const dynamic = "force-dynamic";

/**
 * Crea una sesión Realtime segura:
 * 1) exige la cookie de acceso firmada,
 * 2) aplica rate limiting por IP y global (protege la factura),
 * 3) pide a OpenAI un client secret efímero,
 * 4) devuelve al navegador solo lo necesario para conectar por WebRTC.
 */
export async function POST(request: NextRequest) {
  const { env, missing } = readEnv();
  if (!env) {
    logError("session", `Variables de entorno ausentes: ${missing.join(", ")}`);
    return NextResponse.json(
      { error: { code: "config_missing", message: "El servidor no está configurado todavía." } },
      { status: 503 },
    );
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const session = verifyAccessToken(env.sessionSecret, token);
  const profile = session ? getProfileById(env.profiles, session.profileId, env.identity.allowDynamicProfiles) : null;
  if (!session || !profile) {
    return NextResponse.json(
      { error: { code: "not_authenticated", message: "La sesión de acceso ha caducado." } },
      { status: 401 },
    );
  }

  const ip = clientIpFrom(request.headers);
  const perIp = enforceRateLimit("session-ip", `ip:${ip}`);
  const global = enforceRateLimit("session-global", "global");
  if (!perIp.allowed || !global.allowed) {
    const retryAfterMs = Math.max(perIp.retryAfterMs, global.retryAfterMs);
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiadas sesiones en poco tiempo. Espera un momento." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  // Control de coste (§5): si se alcanzó el límite duro de sesiones del día,
  // se rechaza con un mensaje honesto (nunca se corta a mitad de conversación).
  const dayIso = new Date(Date.now()).toISOString().slice(0, 10);
  const isOwner = profile.role === "owner" && session.identityStatus === "confirmed";
  const costDecision = decideCostAction(
    { sessionsToday: sessionsStartedToday(dayIso), estimatedCostToday: 0 },
    env.costControl,
    isOwner,
  );
  if (costDecision.blockNew) {
    captureMessage("sesión bloqueada por control de coste", { category: "session_create", code: "usage_limited" });
    return NextResponse.json(
      { error: { code: "usage_limited", message: ERROR_COPY.usage_limited.message, hint: ERROR_COPY.usage_limited.hint } },
      { status: 429 },
    );
  }
  recordSessionStarted(dayIso);

  // Recuerdos previos para la continuidad entre sesiones. Un fallo de
  // memoria nunca debe impedir la conversación: se degrada a contexto vacío.
  // La memoria tiene presupuesto duro: si el almacén tarda más de
  // MEMORY_MAX_BLOCKING_MS, la sesión arranca sin contexto (y la memoria
  // llega igualmente por turno y por herramientas). Nunca bloquea la voz.
  // Identidad solo CONFIRMADA abre lo privado (sección 7). Una cookie que
  // "sugiere" a alguien (claimed) no basta: hasta confirmar, contexto público.
  const confirmedIdentity = session.identityStatus === "confirmed";
  let memoryContext = "";
  if (env.memory.enabled) {
    try {
      const store = await getMemoryStore(env);
      memoryContext = await Promise.race([
        buildSessionMemoryContext(store, env, profile, confirmedIdentity),
        new Promise<string>((resolve) => setTimeout(() => resolve(""), env.memory.maxBlockingMs)),
      ]);
    } catch (error) {
      logError("session", "No se pudo construir el contexto de memoria", error);
    }
  }

  // Identidad del interlocutor y autoconocimiento: salen del SERVIDOR.
  const identityStatus = session!.identityStatus;
  const pinNote =
    env.identity.requireOwnerPin && !env.identity.ownerPin
      ? " (aviso: OWNER_IDENTITY_PIN no configurado; el owner se acepta sin PIN en modo demo)"
      : "";
  // Tres estados de interlocutor (sección 7): DESCONOCIDO (preguntar),
  // SUGERIDO (cookie sin confirmar: reconocer con duda, sin abrir lo privado),
  // CONFIRMADO (identidad verificada). El owner sugerido exige PIN.
  const suggested = identityStatus === "claimed" || identityStatus === "guest";
  const identityBlock =
    identityStatus === "unknown"
      ? `

# Interlocutor: DESCONOCIDO
En tu primera respuesta pregunta: "Antes de empezar, dime con quién estoy hablando." Al identificarse ("Soy Sergio"), usa identity_set (si pide PIN, pídelo con naturalidad); si prefieren no decirlo, identity_set con "visitante". Hasta entonces: solo material público/demo, nada privado ni de proyecto.${pinNote}`
      : suggested
        ? `

# Interlocutor: PROBABLE ${profile.displayName} (sin confirmar)
Puede que vuelvas a hablar con ${profile.displayName}, pero NO lo des por seguro. Pregúntalo con naturalidad ("¿Sigues siendo tú, ${profile.displayName}?") y confírmalo con identity_set${profile.role === "owner" ? " (como owner, pídele el PIN)" : ""}. Hasta confirmar: nada privado ni de proyecto; solo material público/demo.${pinNote}`
        : `

# Interlocutor
Hablas con ${profile.displayName} (${profile.role}); no lo anuncies salvo que pregunten. Cambio de persona → identity_set; "olvida quién soy" → identity_reset. Los recuerdos privados de otros NO existen en esta conversación.`;
  let selfKnowledgeBlock = "";
  if (env.memory.selfKnowledgeEnabled) {
    const health = await getMemoryHealth(env).catch(() => null);
    selfKnowledgeBlock = buildSelfKnowledgeBlock(env, health?.persistent ?? false);
  }

  const result = await createRealtimeClientSecret(env, { memoryContext, identityBlock, selfKnowledgeBlock });
  if (!result.ok) {
    captureError(new Error(`session_create: ${result.code}`), {
      category: "session_create",
      code: result.code,
      provider: "openai",
      voiceMode: env.voiceEngine,
    });
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 502 });
  }

  return NextResponse.json({
    clientSecret: result.clientSecret,
    expiresAt: result.expiresAt,
    model: result.model,
    voice: env.voiceEngine === "elevenlabs" ? env.elevenLabsVoiceId : result.voice,
    agentName: result.agentName,
    baseUrl: env.openaiBaseUrl,
    voiceEngine: env.voiceEngine,
    audioGate: {
      enabled: env.audio.gate.enabled,
      calibrationMs: env.audio.gate.calibrationMs,
      minSpeechMs: env.audio.gate.minSpeechMs,
      spikeRejectionMs: env.audio.gate.spikeRejectionMs,
      thresholdMultiplier: env.audio.gate.thresholdMultiplier,
      autoGainControl: env.audio.gate.autoGainControl,
    },
    memory: {
      enabled: env.memory.enabled,
      autoSave: env.memory.autoSave,
    },
    profile: { id: profile.id, displayName: profile.displayName, role: profile.role },
    tts: {
      mode: env.elevenLabsTuning.ttsMode,
      firstChunkMinChars: env.elevenLabsTuning.firstChunkMinChars,
      chunkMinChars: env.elevenLabsTuning.chunkMinChars,
      maxChunkWaitMs: env.elevenLabsTuning.maxChunkWaitMs,
      audioStartBufferMs: env.elevenLabsTuning.audioStartBufferMs,
    },
  });
}
