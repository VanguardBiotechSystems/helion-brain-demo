import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getProfileById } from "@/lib/server/profiles";
import { createRealtimeClientSecret } from "@/lib/server/realtime";
import { buildSessionMemoryContext, getMemoryStore, getMemoryHealth } from "@/lib/server/memory/service";
import { buildSelfKnowledgeBlock } from "@/lib/server/memory/selfKnowledge";
import { clientIpFrom, getLimiter } from "@/lib/server/rateLimit";
import { logError } from "@/lib/server/log";

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
  const profileId = verifyAccessToken(env.sessionSecret, token);
  const profile = getProfileById(env.profiles, profileId);
  if (!profile) {
    return NextResponse.json(
      { error: { code: "not_authenticated", message: "La sesión de acceso ha caducado." } },
      { status: 401 },
    );
  }

  const ip = clientIpFrom(request.headers);
  const perIp = getLimiter("session-ip", 10, 10 * 60 * 1000).check(ip);
  const global = getLimiter("session-global", 40, 10 * 60 * 1000).check("global");
  if (!perIp.allowed || !global.allowed) {
    const retryAfterMs = Math.max(perIp.retryAfterMs, global.retryAfterMs);
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiadas sesiones en poco tiempo. Espera un momento." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  // Recuerdos previos para la continuidad entre sesiones. Un fallo de
  // memoria nunca debe impedir la conversación: se degrada a contexto vacío.
  // La memoria tiene presupuesto duro: si el almacén tarda más de
  // MEMORY_MAX_BLOCKING_MS, la sesión arranca sin contexto (y la memoria
  // llega igualmente por turno y por herramientas). Nunca bloquea la voz.
  let memoryContext = "";
  if (env.memory.enabled) {
    try {
      const store = await getMemoryStore(env);
      memoryContext = await Promise.race([
        buildSessionMemoryContext(store, env, profile),
        new Promise<string>((resolve) => setTimeout(() => resolve(""), env.memory.maxBlockingMs)),
      ]);
    } catch (error) {
      logError("session", "No se pudo construir el contexto de memoria", error);
    }
  }

  // Identidad del interlocutor y autoconocimiento: salen del SERVIDOR.
  const identityBlock = `\n\n# Interlocutor actual\nEstás hablando con ${profile.displayName} (rol: ${profile.role}). Lo sabes por su acceso; no lo anuncies salvo que te lo pregunten ("¿quién soy?", "¿con quién hablas?").\nPRIVACIDAD: solo dispones de los recuerdos autorizados para este perfil. Los recuerdos privados de otras personas NO existen en esta conversación: jamás los menciones ni confirmes su existencia.`;
  let selfKnowledgeBlock = "";
  if (env.memory.selfKnowledgeEnabled) {
    const health = await getMemoryHealth(env).catch(() => null);
    selfKnowledgeBlock = buildSelfKnowledgeBlock(env, health?.persistent ?? false);
  }

  const result = await createRealtimeClientSecret(env, { memoryContext, identityBlock, selfKnowledgeBlock });
  if (!result.ok) {
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
