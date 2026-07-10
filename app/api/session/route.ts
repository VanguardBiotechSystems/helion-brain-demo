import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { createRealtimeClientSecret } from "@/lib/server/realtime";
import { buildSessionMemoryContext, getMemoryStore } from "@/lib/server/memory/service";
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
  if (!verifyAccessToken(env.sessionSecret, token)) {
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
  let memoryContext = "";
  if (env.memory.enabled) {
    try {
      const store = await getMemoryStore(env);
      memoryContext = await buildSessionMemoryContext(store, env);
    } catch (error) {
      logError("session", "No se pudo construir el contexto de memoria", error);
    }
  }

  const result = await createRealtimeClientSecret(env, { memoryContext });
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
  });
}
