/** Tipos compartidos entre cliente y servidor. */

/**
 * Estados del agente. Semántica de escucha (importante):
 * - standby: micrófono conectado pero SIN voz detectada (no se envía audio).
 * - calibrating: midiendo el ruido ambiente de la sala.
 * - voice_detected: energía sostenida, confirmando que es voz humana.
 * - listening: voz confirmada, el audio fluye hacia el modelo.
 */
export type AgentStatus =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "calibrating"
  | "standby"
  | "voice_detected"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

export type ListenMode = "auto" | "ptt";

/** Configuración del gate local que el servidor entrega al cliente. */
export interface ClientGateConfig {
  enabled: boolean;
  calibrationMs: number;
  minSpeechMs: number;
  spikeRejectionMs: number;
  thresholdMultiplier: number;
  autoGainControl: boolean;
}

/** Constraints de micrófono: pedidas vs aplicadas (para diagnóstico). */
export interface MicSettingsInfo {
  deviceLabel: string;
  requested: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
  applied: {
    echoCancellation: boolean | null;
    noiseSuppression: boolean | null;
    autoGainControl: boolean | null;
    sampleRate: number | null;
  };
}

/** Configuración de TTS streaming que el servidor entrega al cliente. */
export interface TtsClientConfig {
  mode: "http_stream" | "http_full";
  firstChunkMinChars: number;
  chunkMinChars: number;
  maxChunkWaitMs: number;
  audioStartBufferMs: number;
}

/** Métricas de latencia de la última generación (modo debug). */
export interface LatencyReport {
  ttsMode: string;
  transport: string;
  speechEndToResponseCreatedMs: number | null;
  speechEndToFirstTextDeltaMs: number | null;
  firstTextDeltaToTtsSendMs: number | null;
  ttsSendToFirstAudioByteMs: number | null;
  speechEndToFirstAudioByteMs: number | null;
  firstAudioByteToPlayMs: number | null;
  speechEndToFirstAudioPlayMs: number | null;
  totalResponseDoneMs: number | null;
  firstChunkChars: number | null;
  chunksSent: number;
  fallbackUsed: boolean;
  cancelled: boolean;
  hadToolCalls: boolean;
}

/** Resumen de recuerdo para UI y herramientas (sin embedding). */
export interface MemorySummary {
  id: string;
  type: string;
  title: string;
  content: string;
  importance: number;
  updatedAt: string;
  score?: number;
}

export type TranscriptRole = "user" | "agent" | "system" | "action";

export interface RobotActionInfo {
  command: string;
  detail?: string;
  status: "simulated" | "rejected";
}

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  text: string;
  at: number;
  pending?: boolean;
  action?: RobotActionInfo;
}

/** Motor que genera la voz del agente. */
export type VoiceEngine = "openai_realtime" | "elevenlabs";

export interface SessionInfo {
  model: string;
  voice: string;
  agentName: string;
  engine: VoiceEngine;
}

/** Respuesta de POST /api/session (sin datos sensibles más allá del token efímero). */
export interface SessionResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
  agentName: string;
  baseUrl: string;
  voiceEngine: VoiceEngine;
  audioGate?: ClientGateConfig;
  memory?: { enabled: boolean; autoSave: boolean };
  versions?: { app: string; prompt: string; selfModel: string };
  /** true si la voz de calidad se degradó a demo_estable por control de coste. */
  voiceDowngraded?: boolean;
  tts?: TtsClientConfig;
}
