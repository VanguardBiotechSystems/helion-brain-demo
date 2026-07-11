"use client";

import { TELEMETRY_SCHEMA_VERSION, type BrowserTag, type DeviceTag, type SessionEndCode, type TelemetryEvent, type VoiceModeTag } from "@/lib/shared/telemetry";

/**
 * Emisión de telemetría AGREGADA desde el cliente (bloque 3, §2). Construye
 * SOLO recuentos y versiones — nunca texto, prompts ni recuerdos — y los
 * envía al terminar la sesión con `keepalive` para que llegue aunque la
 * pestaña se cierre. Un correlationId efímero permite deduplicar reintentos
 * sin identificar a nadie.
 */

function detectBrowser(): BrowserTag {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "firefox";
  // WebKit real (Safari) vs Chromium (que también incluye "Safari" en el UA).
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return "chromium";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "webkit";
  return "other";
}

function detectDevice(): DeviceTag {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPad|Tablet/.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone/.test(ua)) return "mobile";
  return "desktop";
}

function correlationId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // sin crypto: id pseudónimo simple basado en tiempo/perf
  }
  return `c-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e9)}`;
}

export interface SessionTelemetryInput {
  appVersion: string;
  promptVersion: string;
  selfModelVersion: string;
  voiceMode: VoiceModeTag;
  provider: "openai" | "elevenlabs";
  sessionDurationMs: number;
  turns: number;
  latenciesMs: number[];
  fastResponses: number;
  interruptionsAttempted: number;
  interruptionsSucceeded: number;
  noiseBlocked: number;
  reconnects: number;
  errorsByCategory: Record<string, number>;
  fallbacks: number;
  micDeniedOrLost: number;
  memoryAvailability: TelemetryEvent["memoryAvailability"];
  memorySaved: number;
  memoryRejected: number;
  memoryPending: number;
  identitySwitches: number;
  endCode: SessionEndCode;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Construye el evento de telemetría a partir de los datos de sesión. */
export function buildTelemetryEvent(input: SessionTelemetryInput): TelemetryEvent {
  const sorted = [...input.latenciesMs].sort((a, b) => a - b);
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    appVersion: input.appVersion,
    promptVersion: input.promptVersion,
    selfModelVersion: input.selfModelVersion,
    voiceMode: input.voiceMode,
    provider: input.provider,
    browser: detectBrowser(),
    device: detectDevice(),
    correlationId: correlationId(),
    sessionDurationMs: Math.round(input.sessionDurationMs),
    turns: input.turns,
    latencyP50Ms: percentile(sorted, 50),
    latencyP95Ms: percentile(sorted, 95),
    fastResponses: input.fastResponses,
    interruptionsAttempted: input.interruptionsAttempted,
    interruptionsSucceeded: input.interruptionsSucceeded,
    noiseBlocked: input.noiseBlocked,
    reconnects: input.reconnects,
    errorsByCategory: input.errorsByCategory,
    fallbacks: input.fallbacks,
    micDeniedOrLost: input.micDeniedOrLost,
    memoryAvailability: input.memoryAvailability,
    memorySaved: input.memorySaved,
    memoryRejected: input.memoryRejected,
    memoryPending: input.memoryPending,
    identitySwitches: input.identitySwitches,
    endCode: input.endCode,
  };
}

/** Envía la telemetría (best-effort, keepalive). Nunca lanza. */
export function sendTelemetry(input: SessionTelemetryInput): void {
  try {
    const body = JSON.stringify(buildTelemetryEvent(input));
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // La telemetría jamás afecta a la experiencia.
  }
}
