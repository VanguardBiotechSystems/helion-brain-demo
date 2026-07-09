import { createHash } from "node:crypto";

/**
 * Lectura y validación de variables de entorno.
 * Se evalúa por petición (no en import) para que `next build`
 * funcione sin secretos y para que los errores sean claros en runtime.
 */

export type VoiceEngine = "openai_realtime" | "elevenlabs";

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
  /** Motor de voz de salida. openai_realtime = speech-to-speech WebRTC. */
  voiceEngine: VoiceEngine;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  elevenLabsOutputFormat: string;
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
  const missing: string[] = REQUIRED.filter((name) => !source[name]?.trim());

  // El motor de voz externo exige sus propias credenciales: fallar pronto
  // y con nombres claros es mejor que una demo con la voz rota.
  const voiceEngine: VoiceEngine =
    source.VOICE_ENGINE?.trim() === "elevenlabs" ? "elevenlabs" : "openai_realtime";
  if (voiceEngine === "elevenlabs") {
    if (!source.ELEVENLABS_API_KEY?.trim()) missing.push("ELEVENLABS_API_KEY");
    if (!source.ELEVENLABS_VOICE_ID?.trim()) missing.push("ELEVENLABS_VOICE_ID");
  }

  if (missing.length > 0) {
    return { env: null, missing };
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
      realtimeVoice: source.OPENAI_REALTIME_VOICE?.trim() || "cedar",
      transcriptionModel: source.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe",
      transcriptionLanguage,
      turnDetection: source.OPENAI_TURN_DETECTION?.trim() === "server_vad" ? "server_vad" : "semantic_vad",
      textModel: source.OPENAI_TEXT_MODEL?.trim() || "gpt-4.1-mini",
      accessPassword,
      sessionSecret: source.SESSION_SECRET?.trim() || deriveFallbackSecret(accessPassword),
      agentName: source.AGENT_NAME?.trim() || "Atlas",
      appName: source.NEXT_PUBLIC_APP_NAME?.trim() || "Helion",
      voiceEngine,
      elevenLabsApiKey: source.ELEVENLABS_API_KEY?.trim() ?? "",
      elevenLabsVoiceId: source.ELEVENLABS_VOICE_ID?.trim() ?? "",
      elevenLabsModel: source.ELEVENLABS_MODEL?.trim() || "eleven_flash_v2_5",
      elevenLabsOutputFormat: source.ELEVENLABS_OUTPUT_FORMAT?.trim() || "mp3_44100_128",
    },
    missing: [],
  };
}
