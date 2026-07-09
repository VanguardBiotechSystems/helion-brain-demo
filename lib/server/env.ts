import { createHash } from "node:crypto";

/**
 * Lectura y validación de variables de entorno.
 * Se evalúa por petición (no en import) para que `next build`
 * funcione sin secretos y para que los errores sean claros en runtime.
 */

export interface AppEnv {
  openaiApiKey: string;
  openaiBaseUrl: string;
  realtimeModel: string;
  realtimeVoice: string;
  transcriptionModel: string;
  /** ISO-639-1; cadena vacía = autodetección. */
  transcriptionLanguage: string;
  turnDetection: "semantic_vad" | "server_vad";
  textModel: string;
  accessPassword: string;
  sessionSecret: string;
  agentName: string;
  appName: string;
}

export interface EnvResult {
  env: AppEnv | null;
  missing: string[];
}

const REQUIRED = ["OPENAI_API_KEY", "APP_ACCESS_PASSWORD"] as const;

function deriveFallbackSecret(accessPassword: string): string {
  // Derivación determinista para poder firmar cookies sin SESSION_SECRET.
  // Menos robusto que un secreto independiente: se documenta en README.
  return createHash("sha256").update(`helion-session-v1:${accessPassword}`).digest("hex");
}

export function readEnv(source: Record<string, string | undefined> = process.env): EnvResult {
  const missing = REQUIRED.filter((name) => !source[name]?.trim());
  if (missing.length > 0) {
    return { env: null, missing: [...missing] };
  }

  const openaiApiKey = source.OPENAI_API_KEY!.trim();
  const accessPassword = source.APP_ACCESS_PASSWORD!.trim();

  const languageRaw = source.OPENAI_TRANSCRIPTION_LANGUAGE;
  const transcriptionLanguage =
    languageRaw === undefined ? "es" : languageRaw.trim().toLowerCase() === "auto" ? "" : languageRaw.trim();

  return {
    env: {
      openaiApiKey,
      openaiBaseUrl: (source.OPENAI_BASE_URL?.trim() || "https://api.openai.com").replace(/\/+$/, ""),
      realtimeModel: source.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
      realtimeVoice: source.OPENAI_REALTIME_VOICE?.trim() || "marin",
      transcriptionModel: source.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe",
      transcriptionLanguage,
      turnDetection: source.OPENAI_TURN_DETECTION?.trim() === "server_vad" ? "server_vad" : "semantic_vad",
      textModel: source.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1-mini",
      accessPassword,
      sessionSecret: source.SESSION_SECRET?.trim() || deriveFallbackSecret(accessPassword),
      agentName: source.AGENT_NAME?.trim() || "Atlas",
      appName: source.NEXT_PUBLIC_APP_NAME?.trim() || "Helion",
    },
    missing: [],
  };
}
