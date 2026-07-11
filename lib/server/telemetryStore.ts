import type { TelemetryEvent } from "../shared/telemetry";

/**
 * Almacén de telemetría AGREGADA por día (bloque 3, §2). Separado por
 * completo de memorias y conversaciones. En memoria por instancia con
 * retención acotada; suficiente para el panel operativo de una demo. En
 * producción distribuida se sustituiría por una tabla dedicada, pero el
 * contrato agregado (nada de contenido) es idéntico.
 *
 * Idempotencia/dedup: cada evento trae un correlationId; un mismo
 * correlationId no se contabiliza dos veces (reintentos del cliente).
 */

export interface DailyAggregate {
  day: string; // YYYY-MM-DD
  sessions: number;
  turns: number;
  byVoiceMode: Record<string, number>;
  byProvider: Record<string, number>;
  byBrowser: Record<string, number>;
  byDevice: Record<string, number>;
  byEndCode: Record<string, number>;
  errorsByCategory: Record<string, number>;
  fastResponses: number;
  interruptionsAttempted: number;
  interruptionsSucceeded: number;
  noiseBlocked: number;
  reconnects: number;
  fallbacks: number;
  micDeniedOrLost: number;
  identitySwitches: number;
  memorySaved: number;
  memoryRejected: number;
  memoryPending: number;
  memoryDegradedSessions: number;
  totalSessionMs: number;
  longSessions: number; // sesiones anormalmente largas (>20 min)
  latencyP50Samples: number[]; // muestras acotadas para la mediana del día
  latencyP95Samples: number[];
  updatedAt: string;
}

const RETENTION_DAYS = 30;
const MAX_SAMPLES = 500;
const LONG_SESSION_MS = 20 * 60 * 1000;
const SEEN_CAP = 5000;

const store = globalThis as unknown as {
  __helionTelemetry?: Map<string, DailyAggregate>;
  __helionTelemetrySeen?: Set<string>;
  __helionTelemetryRejected?: number;
};

function days(): Map<string, DailyAggregate> {
  return (store.__helionTelemetry ??= new Map());
}
function seen(): Set<string> {
  return (store.__helionTelemetrySeen ??= new Set());
}

function emptyDay(day: string): DailyAggregate {
  return {
    day, sessions: 0, turns: 0, byVoiceMode: {}, byProvider: {}, byBrowser: {}, byDevice: {},
    byEndCode: {}, errorsByCategory: {}, fastResponses: 0, interruptionsAttempted: 0,
    interruptionsSucceeded: 0, noiseBlocked: 0, reconnects: 0, fallbacks: 0, micDeniedOrLost: 0,
    identitySwitches: 0, memorySaved: 0, memoryRejected: 0, memoryPending: 0, memoryDegradedSessions: 0,
    totalSessionMs: 0, longSessions: 0, latencyP50Samples: [], latencyP95Samples: [], updatedAt: "",
  };
}

function inc(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Cuenta el nº de rechazos de telemetría (validación) para el panel. */
export function telemetryRejectedCount(): number {
  return store.__helionTelemetryRejected ?? 0;
}
export function recordTelemetryRejected(): void {
  store.__helionTelemetryRejected = (store.__helionTelemetryRejected ?? 0) + 1;
}

/**
 * Incorpora un evento validado. `dayIso` es la fecha del servidor (YYYY-MM-DD)
 * — el cliente no decide el día. Idempotente por correlationId. Devuelve
 * false si era un duplicado.
 */
export function ingestTelemetry(event: TelemetryEvent, dayIso: string): boolean {
  const seenSet = seen();
  if (event.correlationId && seenSet.has(event.correlationId)) return false;
  if (event.correlationId) {
    if (seenSet.size >= SEEN_CAP) seenSet.clear();
    seenSet.add(event.correlationId);
  }

  const map = days();
  const agg = map.get(dayIso) ?? emptyDay(dayIso);

  agg.sessions += 1;
  agg.turns += event.turns;
  inc(agg.byVoiceMode, event.voiceMode);
  inc(agg.byProvider, event.provider);
  inc(agg.byBrowser, event.browser);
  inc(agg.byDevice, event.device);
  inc(agg.byEndCode, event.endCode);
  for (const [cat, n] of Object.entries(event.errorsByCategory)) inc(agg.errorsByCategory, cat, n);
  agg.fastResponses += event.fastResponses;
  agg.interruptionsAttempted += event.interruptionsAttempted;
  agg.interruptionsSucceeded += event.interruptionsSucceeded;
  agg.noiseBlocked += event.noiseBlocked;
  agg.reconnects += event.reconnects;
  agg.fallbacks += event.fallbacks;
  agg.micDeniedOrLost += event.micDeniedOrLost;
  agg.identitySwitches += event.identitySwitches;
  agg.memorySaved += event.memorySaved;
  agg.memoryRejected += event.memoryRejected;
  agg.memoryPending += event.memoryPending;
  if (event.memoryAvailability === "degraded" || event.memoryAvailability === "unavailable") {
    agg.memoryDegradedSessions += 1;
  }
  agg.totalSessionMs += event.sessionDurationMs;
  if (event.sessionDurationMs >= LONG_SESSION_MS) agg.longSessions += 1;
  if (event.latencyP50Ms !== null && agg.latencyP50Samples.length < MAX_SAMPLES) {
    agg.latencyP50Samples.push(event.latencyP50Ms);
  }
  if (event.latencyP95Ms !== null && agg.latencyP95Samples.length < MAX_SAMPLES) {
    agg.latencyP95Samples.push(event.latencyP95Ms);
  }
  agg.updatedAt = new Date(Date.now()).toISOString();
  map.set(dayIso, agg);

  // Retención: descarta días fuera de ventana.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const key of map.keys()) {
    if (key < cutoff) map.delete(key);
  }
  return true;
}

/** Devuelve los agregados (más reciente primero). Sin muestras crudas. */
export function telemetrySummary(limitDays = 14): Array<Omit<DailyAggregate, "latencyP50Samples" | "latencyP95Samples"> & {
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}> {
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return [...days().values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, limitDays)
    .map(({ latencyP50Samples, latencyP95Samples, ...rest }) => ({
      ...rest,
      latencyP50Ms: median(latencyP50Samples),
      latencyP95Ms: median(latencyP95Samples),
    }));
}

/** Uso agregado de un día (para control de coste). */
export function usageForDay(dayIso: string): { sessions: number; totalSessionMs: number; longSessions: number } {
  const agg = days().get(dayIso);
  return {
    sessions: agg?.sessions ?? 0,
    totalSessionMs: agg?.totalSessionMs ?? 0,
    longSessions: agg?.longSessions ?? 0,
  };
}

/** Cuenta de sesiones arrancadas hoy, independiente de la telemetría de fin
 * de sesión (que puede no llegar). Se incrementa al crear cada sesión. */
const sessionCounter = globalThis as unknown as { __helionSessionsStarted?: Record<string, number> };
export function recordSessionStarted(dayIso: string): void {
  const map = (sessionCounter.__helionSessionsStarted ??= {});
  map[dayIso] = (map[dayIso] ?? 0) + 1;
}
export function sessionsStartedToday(dayIso: string): number {
  return sessionCounter.__helionSessionsStarted?.[dayIso] ?? 0;
}

/** Solo para tests: limpia el estado global. */
export function __resetTelemetry(): void {
  sessionCounter.__helionSessionsStarted = {};
  store.__helionTelemetry = new Map();
  store.__helionTelemetrySeen = new Set();
  store.__helionTelemetryRejected = 0;
}
