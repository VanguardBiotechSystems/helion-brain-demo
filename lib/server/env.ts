import { createHash } from "node:crypto";

/**
 * Lectura y validación de variables de entorno.
 * Se evalúa por petición (no en import) para que `next build`
 * funcione sin secretos y para que los errores sean claros en runtime.
 */

export type VoiceEngine = "openai_realtime" | "elevenlabs";
export type AudioProfile = "demo_balanced" | "laptop_demo" | "near_field" | "far_field" | "robot_room";
export type TurnDetectionMode = "semantic_vad" | "server_vad";
export type NoiseReductionMode = "near_field" | "far_field" | "off";
export type VadEagerness = "low" | "medium" | "high" | "auto";
export type MemoryProvider = "local" | "postgres";

export interface AudioGateEnvConfig {
  enabled: boolean;
  calibrationMs: number;
  minSpeechMs: number;
  spikeRejectionMs: number;
  thresholdMultiplier: number;
  /** AGC del navegador: apagado por defecto para no amplificar ruido. */
  autoGainControl: boolean;
}

export interface AudioConfig {
  profile: AudioProfile;
  turnDetection: TurnDetectionMode;
  vadThreshold: number;
  vadSilenceMs: number;
  /** true si OPENAI_VAD_SILENCE_MS vino explícito en el entorno. */
  vadSilenceMsFromEnv: boolean;
  vadPrefixPaddingMs: number;
  vadEagerness: VadEagerness;
  noiseReduction: NoiseReductionMode;
  gate: AudioGateEnvConfig;
}

export type TtsMode = "http_stream" | "http_full";

export interface ElevenLabsTuning {
  /** Modo pedido en env (websocket_stream se resuelve a http_stream; ver docs). */
  ttsModeRequested: string;
  ttsMode: TtsMode;
  speed: number;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  firstChunkMinChars: number;
  chunkMinChars: number;
  maxChunkWaitMs: number;
  audioStartBufferMs: number;
}

export interface HelionTuning {
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  latencyMode: "fast" | "balanced";
  maxNormalSentences: number;
}

export interface MemoryConfig {
  enabled: boolean;
  provider: MemoryProvider;
  databaseUrl: string;
  localPath: string;
  embeddingModel: string;
  extractionModel: string;
  retrievalTopK: number;
  minImportance: number;
  autoSave: boolean;
  requireConfirmationForSensitive: boolean;
  retentionDays: number | null;
  debug: boolean;
  /** Presupuesto duro de bloqueo de memoria en el camino crítico (ms). */
  maxBlockingMs: number;
}

export interface AppEnv {
  openaiApiKey: string;
  openaiBaseUrl: string;
  realtimeModel: string;
  realtimeVoice: string;
  transcriptionModel: string;
  /** ISO-639-1; cadena vacía = autodetección. */
  transcriptionLanguage: string;
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
  elevenLabsTuning: ElevenLabsTuning;
  helion: HelionTuning;
  audio: AudioConfig;
  memory: MemoryConfig;
}

export interface EnvResult {
  env: AppEnv | null;
  missing: string[];
}

const REQUIRED = ["OPENAI_API_KEY", "APP_ACCESS_PASSWORD"] as const;

interface AudioProfilePreset
  extends Pick<
    AudioConfig,
    "turnDetection" | "vadThreshold" | "vadSilenceMs" | "vadPrefixPaddingMs" | "vadEagerness" | "noiseReduction"
  > {
  gateThresholdMultiplier: number;
  gateMinSpeechMs: number;
  gateSpikeRejectionMs: number;
}

/**
 * Perfiles de escucha. Un perfil define valores razonables para el VAD de
 * OpenAI, la reducción de ruido y el gate local; cualquier variable
 * individual (OPENAI_* / LOCAL_AUDIO_*) los sobreescribe. Ver docs/AUDIO_GATE.md.
 *
 * - demo_balanced (por defecto): equilibrio para demo en portátil — detecta
 *   voz a volumen conversacional sin perder inicios de frase, y sigue
 *   ignorando tecleo y golpes. VAD 0.5/650 ms + prefix 400 ms.
 * - laptop_demo: variante estricta (entornos ruidosos): umbral más alto y
 *   confirmación de voz más larga.
 * - near_field: micro cercano con turnos naturales (semantic_vad).
 * - far_field / robot_room: micro lejano en habitación; VAD más exigente.
 */
const AUDIO_PROFILES: Record<AudioProfile, AudioProfilePreset> = {
  demo_balanced: {
    turnDetection: "server_vad",
    vadThreshold: 0.5,
    vadSilenceMs: 650,
    vadPrefixPaddingMs: 400,
    vadEagerness: "low",
    noiseReduction: "near_field",
    gateThresholdMultiplier: 2.0,
    gateMinSpeechMs: 220,
    gateSpikeRejectionMs: 160,
  },
  laptop_demo: {
    turnDetection: "server_vad",
    vadThreshold: 0.6,
    vadSilenceMs: 700,
    vadPrefixPaddingMs: 300,
    vadEagerness: "low",
    noiseReduction: "near_field",
    gateThresholdMultiplier: 2.5,
    gateMinSpeechMs: 300,
    gateSpikeRejectionMs: 180,
  },
  near_field: {
    turnDetection: "semantic_vad",
    vadThreshold: 0.55,
    vadSilenceMs: 600,
    vadPrefixPaddingMs: 300,
    vadEagerness: "auto",
    noiseReduction: "near_field",
    gateThresholdMultiplier: 2.2,
    gateMinSpeechMs: 250,
    gateSpikeRejectionMs: 170,
  },
  far_field: {
    turnDetection: "server_vad",
    vadThreshold: 0.65,
    vadSilenceMs: 800,
    vadPrefixPaddingMs: 400,
    vadEagerness: "low",
    noiseReduction: "far_field",
    gateThresholdMultiplier: 2.5,
    gateMinSpeechMs: 300,
    gateSpikeRejectionMs: 180,
  },
  robot_room: {
    turnDetection: "server_vad",
    vadThreshold: 0.65,
    vadSilenceMs: 800,
    vadPrefixPaddingMs: 400,
    vadEagerness: "low",
    noiseReduction: "far_field",
    gateThresholdMultiplier: 2.5,
    gateMinSpeechMs: 300,
    gateSpikeRejectionMs: 180,
  },
};

function deriveFallbackSecret(accessPassword: string): string {
  // Derivación determinista para poder firmar cookies sin SESSION_SECRET.
  // Menos robusto que un secreto independiente: se documenta en README.
  return createHash("sha256").update(`helion-session-v1:${accessPassword}`).digest("hex");
}

function parseNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw?.trim());
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return fallback;
}

function parseEnum<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  const value = raw?.trim() as T | undefined;
  return value && allowed.includes(value) ? value : fallback;
}

function readAudioConfig(source: Record<string, string | undefined>): AudioConfig {
  const profile = parseEnum<AudioProfile>(
    source.AUDIO_PROFILE,
    ["demo_balanced", "laptop_demo", "near_field", "far_field", "robot_room"],
    "demo_balanced",
  );
  const preset = AUDIO_PROFILES[profile];

  return {
    profile,
    turnDetection: parseEnum<TurnDetectionMode>(
      source.OPENAI_TURN_DETECTION,
      ["semantic_vad", "server_vad"],
      preset.turnDetection,
    ),
    vadThreshold: parseNumber(source.OPENAI_VAD_THRESHOLD, preset.vadThreshold, 0, 1),
    vadSilenceMs: parseNumber(source.OPENAI_VAD_SILENCE_MS, preset.vadSilenceMs, 100, 5000),
    vadSilenceMsFromEnv: Boolean(
      source.OPENAI_VAD_SILENCE_MS?.trim() && Number.isFinite(Number(source.OPENAI_VAD_SILENCE_MS.trim())),
    ),
    vadPrefixPaddingMs: parseNumber(source.OPENAI_VAD_PREFIX_PADDING_MS, preset.vadPrefixPaddingMs, 0, 2000),
    vadEagerness: parseEnum<VadEagerness>(
      source.OPENAI_VAD_EAGERNESS,
      ["low", "medium", "high", "auto"],
      preset.vadEagerness,
    ),
    noiseReduction: parseEnum<NoiseReductionMode>(
      source.OPENAI_NOISE_REDUCTION,
      ["near_field", "far_field", "off"],
      preset.noiseReduction,
    ),
    gate: {
      enabled: parseBoolean(source.LOCAL_AUDIO_GATE_ENABLED, true),
      calibrationMs: parseNumber(source.LOCAL_AUDIO_CALIBRATION_MS, 2000, 500, 10000),
      minSpeechMs: parseNumber(source.LOCAL_AUDIO_MIN_SPEECH_MS, preset.gateMinSpeechMs, 100, 2000),
      spikeRejectionMs: parseNumber(
        source.LOCAL_AUDIO_SPIKE_REJECTION_MS,
        preset.gateSpikeRejectionMs,
        40,
        1000,
      ),
      thresholdMultiplier: parseNumber(
        source.LOCAL_AUDIO_THRESHOLD_MULTIPLIER,
        preset.gateThresholdMultiplier,
        1.2,
        10,
      ),
      autoGainControl: parseBoolean(source.LOCAL_AUDIO_AGC, false),
    },
  };
}

function readMemoryConfig(source: Record<string, string | undefined>): MemoryConfig {
  const retentionRaw = parseNumber(source.MEMORY_RETENTION_DAYS, 0, 0, 36500);
  return {
    enabled: parseBoolean(source.MEMORY_ENABLED, true),
    provider: parseEnum<MemoryProvider>(source.MEMORY_PROVIDER, ["local", "postgres"], "local"),
    databaseUrl: source.DATABASE_URL?.trim() ?? "",
    localPath: source.MEMORY_LOCAL_PATH?.trim() || ".data/memory.json",
    embeddingModel: source.MEMORY_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    extractionModel: source.MEMORY_EXTRACTION_MODEL?.trim() || "gpt-4.1-mini",
    retrievalTopK: parseNumber(source.MEMORY_RETRIEVAL_TOP_K, 8, 1, 50),
    minImportance: parseNumber(source.MEMORY_MIN_IMPORTANCE, 0.55, 0, 1),
    autoSave: parseBoolean(source.MEMORY_AUTO_SAVE, true),
    requireConfirmationForSensitive: parseBoolean(source.MEMORY_REQUIRE_CONFIRMATION_FOR_SENSITIVE, true),
    retentionDays: retentionRaw > 0 ? retentionRaw : null,
    debug: parseBoolean(source.MEMORY_DEBUG, false),
    maxBlockingMs: parseNumber(source.MEMORY_MAX_BLOCKING_MS, 200, 50, 2000),
  };
}

function readElevenLabsTuning(source: Record<string, string | undefined>): ElevenLabsTuning {
  const requested = source.ELEVENLABS_TTS_MODE?.trim() || "websocket_stream";
  // websocket_stream (stream-input de ElevenLabs) exige un servidor de voz
  // con estado, incompatible con serverless: se resuelve al streaming HTTP
  // chunked, que da un TTFB equivalente por fragmento. Ver docs/DEMO_HANDOFF.md.
  const ttsMode: TtsMode = requested === "http_full" ? "http_full" : "http_stream";
  return {
    ttsModeRequested: requested,
    ttsMode,
    speed: parseNumber(source.ELEVENLABS_SPEED, 1.08, 0.7, 1.2),
    stability: parseNumber(source.ELEVENLABS_STABILITY, 0.45, 0, 1),
    similarityBoost: parseNumber(source.ELEVENLABS_SIMILARITY_BOOST, 0.75, 0, 1),
    // style > 0 añade latencia según la documentación de ElevenLabs:
    // por defecto 0; súbelo solo si prefieres expresividad a velocidad.
    style: parseNumber(source.ELEVENLABS_STYLE, 0, 0, 1),
    useSpeakerBoost: parseBoolean(source.ELEVENLABS_USE_SPEAKER_BOOST, false),
    firstChunkMinChars: parseNumber(source.ELEVENLABS_FIRST_CHUNK_MIN_CHARS, 12, 4, 120),
    chunkMinChars: parseNumber(source.ELEVENLABS_CHUNK_MIN_CHARS, 35, 10, 300),
    maxChunkWaitMs: parseNumber(source.ELEVENLABS_MAX_CHUNK_WAIT_MS, 80, 20, 1000),
    audioStartBufferMs: parseNumber(source.ELEVENLABS_AUDIO_START_BUFFER_MS, 50, 0, 1000),
  };
}

function readHelionTuning(source: Record<string, string | undefined>): HelionTuning {
  return {
    reasoningEffort: parseEnum(source.HELION_REASONING_EFFORT, ["minimal", "low", "medium", "high"], "low"),
    latencyMode: parseEnum(source.HELION_LATENCY_MODE, ["fast", "balanced"], "fast"),
    maxNormalSentences: parseNumber(source.HELION_MAX_NORMAL_SENTENCES, 1, 1, 4),
  };
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

  const memory = readMemoryConfig(source);
  if (memory.enabled && memory.provider === "postgres" && !memory.databaseUrl) {
    missing.push("DATABASE_URL");
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
      elevenLabsTuning: readElevenLabsTuning(source),
      helion: readHelionTuning(source),
      audio: readAudioConfig(source),
      memory,
    },
    missing: [],
  };
}
