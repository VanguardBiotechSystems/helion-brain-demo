/**
 * Contrato de telemetría AGREGADA (bloque 3, §2). Versionado y estricto.
 * NUNCA transporta texto pronunciado/generado, contenido de memoria, nombre
 * de perfil, PIN, correo, identificadores persistentes, payloads de
 * herramientas ni prompts. Solo recuentos, latencias, categorías y versiones.
 *
 * Este archivo es compartido (cliente construye, servidor valida). El
 * validador rechaza campos desconocidos: el esquema es la única forma válida.
 */

export const TELEMETRY_SCHEMA_VERSION = 1;

export type VoiceModeTag = "demo_estable" | "calidad_voz" | "futuro_gateway" | "unknown";
export type DeviceTag = "desktop" | "mobile" | "tablet" | "unknown";
export type BrowserTag = "chromium" | "webkit" | "firefox" | "other";
export type MemoryAvailabilityTag = "available" | "degraded" | "unavailable";
export type SessionEndCode =
  | "user_ended"
  | "error"
  | "timeout"
  | "reconnect_failed"
  | "usage_limited"
  | "provider_down"
  | "unknown";

export interface TelemetryEvent {
  schemaVersion: number;
  appVersion: string;
  promptVersion: string;
  selfModelVersion: string;
  voiceMode: VoiceModeTag;
  provider: "openai" | "elevenlabs";
  browser: BrowserTag;
  device: DeviceTag;
  /** Id de correlación efímero y pseudónimo (no rastreable a una persona). */
  correlationId: string;
  sessionDurationMs: number;
  turns: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  fastResponses: number;
  interruptionsAttempted: number;
  interruptionsSucceeded: number;
  noiseBlocked: number;
  reconnects: number;
  errorsByCategory: Record<string, number>;
  fallbacks: number;
  micDeniedOrLost: number;
  memoryAvailability: MemoryAvailabilityTag;
  memorySaved: number;
  memoryRejected: number;
  memoryPending: number;
  identitySwitches: number;
  endCode: SessionEndCode;
}

const VOICE_MODES: VoiceModeTag[] = ["demo_estable", "calidad_voz", "futuro_gateway", "unknown"];
const DEVICES: DeviceTag[] = ["desktop", "mobile", "tablet", "unknown"];
const BROWSERS: BrowserTag[] = ["chromium", "webkit", "firefox", "other"];
const MEM_AVAIL: MemoryAvailabilityTag[] = ["available", "degraded", "unavailable"];
const END_CODES: SessionEndCode[] = [
  "user_ended", "error", "timeout", "reconnect_failed", "usage_limited", "provider_down", "unknown",
];

const ALLOWED_KEYS = new Set<string>([
  "schemaVersion", "appVersion", "promptVersion", "selfModelVersion", "voiceMode", "provider",
  "browser", "device", "correlationId", "sessionDurationMs", "turns", "latencyP50Ms", "latencyP95Ms",
  "fastResponses", "interruptionsAttempted", "interruptionsSucceeded", "noiseBlocked", "reconnects",
  "errorsByCategory", "fallbacks", "micDeniedOrLost", "memoryAvailability", "memorySaved",
  "memoryRejected", "memoryPending", "identitySwitches", "endCode",
]);

/** Tamaño máximo del cuerpo aceptado (bytes) para evitar abuso. */
export const TELEMETRY_MAX_BYTES = 4096;

export interface TelemetryValidation {
  ok: boolean;
  event?: TelemetryEvent;
  errors: string[];
}

function num(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function str(v: unknown, max = 40): string {
  return typeof v === "string" ? v.replace(/[^\w.\-]/g, "").slice(0, max) : "";
}

/**
 * Valida y NORMALIZA un evento de telemetría. Rechaza si hay campos
 * desconocidos, versión de esquema incorrecta o enums inválidos. Recorta y
 * acota el resto: la telemetría nunca debe hacer caer al servidor.
 */
export function validateTelemetry(raw: unknown): TelemetryValidation {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, errors: ["cuerpo no es un objeto"] };
  }
  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(`campo desconocido: ${key}`);
  }
  if (obj.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    errors.push(`schemaVersion debe ser ${TELEMETRY_SCHEMA_VERSION}`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const errorsByCategory: Record<string, number> = {};
  if (obj.errorsByCategory && typeof obj.errorsByCategory === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(obj.errorsByCategory as Record<string, unknown>)) {
      if (n >= 20) break;
      const count = num(v, 0, 100_000);
      if (count !== null) errorsByCategory[str(k, 24)] = count;
      n += 1;
    }
  }

  const event: TelemetryEvent = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    appVersion: str(obj.appVersion, 24),
    promptVersion: str(obj.promptVersion, 24),
    selfModelVersion: str(obj.selfModelVersion, 24),
    voiceMode: VOICE_MODES.includes(obj.voiceMode as VoiceModeTag) ? (obj.voiceMode as VoiceModeTag) : "unknown",
    provider: obj.provider === "elevenlabs" ? "elevenlabs" : "openai",
    browser: BROWSERS.includes(obj.browser as BrowserTag) ? (obj.browser as BrowserTag) : "other",
    device: DEVICES.includes(obj.device as DeviceTag) ? (obj.device as DeviceTag) : "unknown",
    correlationId: str(obj.correlationId, 40),
    sessionDurationMs: num(obj.sessionDurationMs, 0, 86_400_000) ?? 0,
    turns: num(obj.turns, 0, 100_000) ?? 0,
    latencyP50Ms: num(obj.latencyP50Ms, 0, 600_000),
    latencyP95Ms: num(obj.latencyP95Ms, 0, 600_000),
    fastResponses: num(obj.fastResponses, 0, 100_000) ?? 0,
    interruptionsAttempted: num(obj.interruptionsAttempted, 0, 100_000) ?? 0,
    interruptionsSucceeded: num(obj.interruptionsSucceeded, 0, 100_000) ?? 0,
    noiseBlocked: num(obj.noiseBlocked, 0, 1_000_000) ?? 0,
    reconnects: num(obj.reconnects, 0, 100_000) ?? 0,
    errorsByCategory,
    fallbacks: num(obj.fallbacks, 0, 100_000) ?? 0,
    micDeniedOrLost: num(obj.micDeniedOrLost, 0, 100_000) ?? 0,
    memoryAvailability: MEM_AVAIL.includes(obj.memoryAvailability as MemoryAvailabilityTag)
      ? (obj.memoryAvailability as MemoryAvailabilityTag)
      : "unavailable",
    memorySaved: num(obj.memorySaved, 0, 100_000) ?? 0,
    memoryRejected: num(obj.memoryRejected, 0, 100_000) ?? 0,
    memoryPending: num(obj.memoryPending, 0, 100_000) ?? 0,
    identitySwitches: num(obj.identitySwitches, 0, 100_000) ?? 0,
    endCode: END_CODES.includes(obj.endCode as SessionEndCode) ? (obj.endCode as SessionEndCode) : "unknown",
  };

  if (!event.correlationId) errors.push("falta correlationId");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, event, errors: [] };
}
