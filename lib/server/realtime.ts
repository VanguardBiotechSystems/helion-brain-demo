import type { ErrorCode } from "@/lib/shared/errors";
import { REALTIME_ROBOT_TOOLS } from "@/lib/robot/tools";
import { REALTIME_MEMORY_TOOLS } from "./memory/tools";
import { REALTIME_IDENTITY_TOOLS } from "./identityTools";
import type { AppEnv } from "./env";
import { buildAgentInstructions } from "./personality";
import { logError, logInfo } from "./log";

/**
 * Creación de credenciales efímeras para la sesión Realtime.
 * La API key real solo se usa aquí, en servidor. El navegador recibe
 * únicamente un client secret efímero (caduca en minutos).
 */

const CLIENT_SECRET_TTL_SECONDS = 600;

export interface RealtimeSessionSuccess {
  ok: true;
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
  agentName: string;
}

export interface RealtimeSessionFailure {
  ok: false;
  code: ErrorCode;
  message: string;
}

export type RealtimeSessionResult = RealtimeSessionSuccess | RealtimeSessionFailure;

export interface SessionConfigExtras {
  /** Bloque de recuerdos previos para las instrucciones (puede ser ""). */
  memoryContext?: string;
  /** Identidad del interlocutor actual (construida en servidor). */
  identityBlock?: string;
  /** Autoconocimiento seguro de Helion (runtime). */
  selfKnowledgeBlock?: string;
}

export function buildRealtimeSessionConfig(
  env: AppEnv,
  extras: SessionConfigExtras = {},
): Record<string, unknown> {
  const audioCfg = env.audio;

  // La detección de turnos se parametriza por perfil de audio (ver
  // docs/AUDIO_GATE.md): server_vad conservador por defecto para no
  // dispararse con ruido; semantic_vad disponible por configuración.
  // Modo latencia rápida + voz externa: el silencio del VAD baja a 500 ms
  // (la síntesis externa ya añade su propio coste). Un override explícito
  // de OPENAI_VAD_SILENCE_MS siempre gana.
  const vadSilenceMs =
    env.helion.latencyMode === "fast" && env.voiceEngine === "elevenlabs" && !audioCfg.vadSilenceMsFromEnv
      ? Math.min(audioCfg.vadSilenceMs, 500)
      : audioCfg.vadSilenceMs;

  // Escucha permanente con activación inteligente: en modo "directed" el
  // servidor NO responde automáticamente a cada turno detectado. El VAD
  // segmenta y transcribe, y el CLIENTE decide (AddressingGate) si Helion
  // debe responder — solo entonces envía response.create. interrupt_response
  // se mantiene para que la voz del usuario corte a Helion (barge-in).
  const autoRespond = env.wake.mode !== "directed";
  // En modo directed el servidor NO debe interrumpir a Helion cada vez que el
  // VAD detecta voz (ruido, otra persona, charla de fondo): eso lo cortaba a
  // media frase aunque no se le hablara a él. La interrupción la decide el
  // CLIENTE: solo corta si el turno va dirigido ("Helion…") o es un "para".
  const serverInterrupt = autoRespond;
  const turnDetection =
    audioCfg.turnDetection === "server_vad"
      ? {
          type: "server_vad",
          threshold: audioCfg.vadThreshold,
          prefix_padding_ms: audioCfg.vadPrefixPaddingMs,
          silence_duration_ms: vadSilenceMs,
          create_response: autoRespond,
          interrupt_response: serverInterrupt,
        }
      : {
          type: "semantic_vad",
          eagerness: audioCfg.vadEagerness,
          create_response: autoRespond,
          interrupt_response: serverInterrupt,
        };

  const transcription: Record<string, string> = { model: env.transcriptionModel };
  if (env.transcriptionLanguage) {
    transcription.language = env.transcriptionLanguage;
  }
  // Pista de contexto: ancla el idioma y los nombres propios frecuentes para
  // que el STT no salte de alfabeto ni invente palabras sobre audio ruidoso.
  if (env.transcriptionPrompt) {
    transcription.prompt = env.transcriptionPrompt;
  }

  // Con motor de voz externo (ElevenLabs), el modelo responde solo texto:
  // los oídos (VAD + transcripción) siguen siendo los de la sesión realtime,
  // y la voz la sintetiza el servidor con el TtsProvider configurado.
  const input: Record<string, unknown> = {
    transcription,
    turn_detection: turnDetection,
  };
  if (audioCfg.noiseReduction !== "off") {
    input.noise_reduction = { type: audioCfg.noiseReduction };
  }

  const audio: Record<string, unknown> = { input };
  if (env.voiceEngine === "openai_realtime") {
    audio.output = { voice: env.realtimeVoice };
  }

  const tools = [
    ...REALTIME_ROBOT_TOOLS,
    ...(env.memory.enabled ? REALTIME_MEMORY_TOOLS : []),
    ...(env.identity.enabled ? REALTIME_IDENTITY_TOOLS : []),
  ];

  const config: Record<string, unknown> = {
    type: "realtime",
    model: env.realtimeModel,
    instructions: buildAgentInstructions(env.agentName, env.voiceEngine, {
      memoryEnabled: env.memory.enabled,
      memoryContext: extras.memoryContext,
      identityBlock: extras.identityBlock,
      selfKnowledgeBlock: extras.selfKnowledgeBlock,
    }),
    output_modalities: env.voiceEngine === "elevenlabs" ? ["text"] : ["audio"],
    audio,
    tools,
    tool_choice: "auto",
  };

  // Los modelos realtime 2.x razonan; para voz el esfuerzo se mantiene
  // bajo (configurable con HELION_REASONING_EFFORT).
  if (/^gpt-realtime-2/.test(env.realtimeModel)) {
    config.reasoning = { effort: env.helion.reasoningEffort };
  }

  return config;
}

export async function createRealtimeClientSecret(
  env: AppEnv,
  extras: SessionConfigExtras = {},
): Promise<RealtimeSessionResult> {
  let response: Response;
  try {
    response = await fetch(`${env.openaiBaseUrl}/v1/realtime/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SECONDS },
        session: buildRealtimeSessionConfig(env, extras),
      }),
      cache: "no-store",
    });
  } catch (error) {
    logError("realtime", "No se pudo contactar con la API de OpenAI", error);
    return {
      ok: false,
      code: "openai_error",
      message: "No se pudo contactar con OpenAI. Revisa la conexión del servidor.",
    };
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    logError("realtime", `client_secrets fallo status=${response.status} body=${bodyText.slice(0, 600)}`);
    return mapOpenAiFailure(response.status, bodyText);
  }

  const data = (await response.json().catch(() => null)) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
  } | null;

  const clientSecret = data?.value ?? data?.client_secret?.value;
  const expiresAt = data?.expires_at ?? data?.client_secret?.expires_at ?? 0;

  if (!clientSecret) {
    logError("realtime", "Respuesta de client_secrets sin token efímero");
    return {
      ok: false,
      code: "session_create_failed",
      message: "OpenAI devolvió una respuesta inesperada al crear la sesión.",
    };
  }

  logInfo("realtime", `Sesión efímera creada (modelo=${env.realtimeModel}, voz=${env.realtimeVoice})`);
  return {
    ok: true,
    clientSecret,
    expiresAt,
    model: env.realtimeModel,
    voice: env.realtimeVoice,
    agentName: env.agentName,
  };
}

export function mapOpenAiFailure(status: number, bodyText: string): RealtimeSessionFailure {
  const body = bodyText.toLowerCase();

  if (status === 401) {
    return { ok: false, code: "invalid_api_key", message: "La clave de OpenAI configurada no es válida." };
  }
  if (status === 403) {
    return {
      ok: false,
      code: "invalid_api_key",
      message: "La clave de OpenAI no tiene permisos para la API Realtime.",
    };
  }
  if (status === 404 || (body.includes("model") && (body.includes("not exist") || body.includes("not found")))) {
    return {
      ok: false,
      code: "model_unavailable",
      message: "El modelo realtime configurado no está disponible en esta cuenta.",
    };
  }
  if (status === 429) {
    if (body.includes("insufficient_quota") || body.includes("quota")) {
      return {
        ok: false,
        code: "quota_exceeded",
        message: "La cuenta de OpenAI no tiene crédito disponible.",
      };
    }
    return {
      ok: false,
      code: "rate_limited",
      message: "OpenAI está limitando las peticiones. Espera unos segundos.",
    };
  }
  return {
    ok: false,
    code: "openai_error",
    message: "OpenAI devolvió un error inesperado al crear la sesión de voz.",
  };
}
