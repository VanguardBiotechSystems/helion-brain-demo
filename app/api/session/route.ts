import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getProfileById, type IdentityStatus } from "@/lib/server/profiles";
import { createRealtimeClientSecret } from "@/lib/server/realtime";
import { buildSessionMemoryContext, getMemoryStore, getMemoryHealth } from "@/lib/server/memory/service";
import { buildSelfKnowledgeBlock, SELF_KNOWLEDGE_VERSION } from "@/lib/server/memory/selfKnowledge";
import { VOICE_CONSTITUTION_VERSION } from "@/lib/server/personality";
import { buildIdentityBlock, ownerPinNote } from "@/lib/server/identityPrompt";
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
  // Solo se consume el bucket global si la IP pasó su límite: así una sola IP
  // bloqueada no puede agotar el cupo global (DoS de baja intensidad).
  const global = perIp.allowed ? enforceRateLimit("session-global", "global") : { allowed: true, retryAfterMs: 0 };
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
  // Tres estados (§7): DESCONOCIDO (preguntar), SUGERIDO (cookie sin
  // confirmar: reconocer con duda, sin abrir lo privado), CONFIRMADO. El
  // bloque lo construye lib/server/identityPrompt.ts (medido por el test de
  // presupuesto contra el código real).
  // Con la identificación desactivada, Helion NO reconoce a su interlocutor:
  // habla con cualquiera igual (su deferencia a Sergio vive en su lore, no en
  // una identidad de sesión). Se omite el bloque de interlocutor por completo.
  const identityStatus = session!.identityStatus as IdentityStatus;
  const pinNote = ownerPinNote(env.identity.requireOwnerPin, env.identity.ownerPin);
  const identityBlock = env.identity.enabled ? buildIdentityBlock(identityStatus, profile, pinNote) : "";
  let selfKnowledgeBlock = "";
  if (env.memory.selfKnowledgeEnabled) {
    // getMemoryHealth NO debe volver al camino crítico sin presupuesto: se
    // corre con el mismo tope de bloqueo que el contexto de memoria y, si
    // tarda, se asume no persistente (Helion lo dirá con honestidad).
    const health = await Promise.race([
      getMemoryHealth(env).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), env.memory.maxBlockingMs)),
    ]);
    selfKnowledgeBlock = buildSelfKnowledgeBlock(env, health?.persistent ?? false);
  }

  // Control de coste (§5): si la decisión pide degradar la voz (límite blando
  // o kill switch de ElevenLabs), la sesión usa demo_estable (OpenAI) de forma
  // INFORMADA — el cliente recibe voiceDowngraded para avisar, nunca un cambio
  // de voz silencioso.
  const voiceDowngraded = costDecision.downgradeVoice && env.voiceEngine === "elevenlabs";
  const effectiveEngine = voiceDowngraded ? "openai_realtime" : env.voiceEngine;
  const sessionEnv = voiceDowngraded ? { ...env, voiceEngine: "openai_realtime" as const } : env;

  const result = await createRealtimeClientSecret(sessionEnv, { memoryContext, identityBlock, selfKnowledgeBlock });
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
    voice: effectiveEngine === "elevenlabs" ? env.elevenLabsVoiceId : result.voice,
    agentName: result.agentName,
    baseUrl: env.openaiBaseUrl,
    voiceEngine: effectiveEngine,
    voiceDowngraded,
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
    profile: { id: profile.id, displayName: profile.displayName, role: profile.role, identityStatus },
    wake: {
      mode: env.wake.mode,
      wakeStrategy: env.wake.wakeStrategy,
      agentNames: env.wake.agentNames,
      requireDirectAddress: env.wake.requireDirectAddress,
      attentionWindowMs: env.wake.attentionWindowMs,
      minConfidence: env.wake.minConfidence,
      respondToMentions: env.wake.respondToMentions,
      rulesFirst: env.wake.rulesFirst,
      requireNameForFirstTurn: env.wake.requireNameForFirstTurn,
      allowBackgroundTranscript: env.wake.allowBackgroundTranscript,
      modelClassifierEnabled: env.wake.modelClassifierEnabled,
    },
    ui: env.ui,
    versions: {
      app: process.env.npm_package_version ?? "0.1.0",
      prompt: VOICE_CONSTITUTION_VERSION,
      selfModel: SELF_KNOWLEDGE_VERSION,
    },
    tts: {
      mode: env.elevenLabsTuning.ttsMode,
      firstChunkMinChars: env.elevenLabsTuning.firstChunkMinChars,
      chunkMinChars: env.elevenLabsTuning.chunkMinChars,
      maxChunkWaitMs: env.elevenLabsTuning.maxChunkWaitMs,
      audioStartBufferMs: env.elevenLabsTuning.audioStartBufferMs,
    },
  });
}
