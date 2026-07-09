import type { ErrorCode } from "@/lib/shared/errors";
import { REALTIME_ROBOT_TOOLS } from "@/lib/robot/tools";
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

export function buildRealtimeSessionConfig(env: AppEnv): Record<string, unknown> {
  const turnDetection =
    env.turnDetection === "server_vad"
      ? {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: true,
          interrupt_response: true,
        }
      : {
          type: "semantic_vad",
          eagerness: "auto",
          create_response: true,
          interrupt_response: true,
        };

  const transcription: Record<string, string> = { model: env.transcriptionModel };
  if (env.transcriptionLanguage) {
    transcription.language = env.transcriptionLanguage;
  }

  const config: Record<string, unknown> = {
    type: "realtime",
    model: env.realtimeModel,
    instructions: buildAgentInstructions(env.agentName),
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription,
        turn_detection: turnDetection,
      },
      output: {
        voice: env.realtimeVoice,
      },
    },
    tools: REALTIME_ROBOT_TOOLS,
    tool_choice: "auto",
  };

  // Los modelos realtime 2.x razonan; para conversación de baja latencia
  // la documentación recomienda empezar con esfuerzo bajo.
  if (/^gpt-realtime-2/.test(env.realtimeModel)) {
    config.reasoning = { effort: "low" };
  }

  return config;
}

export async function createRealtimeClientSecret(env: AppEnv): Promise<RealtimeSessionResult> {
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
        session: buildRealtimeSessionConfig(env),
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
