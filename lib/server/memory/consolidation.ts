import { cosineSimilarity } from "./embeddings";
import { expireStalePending } from "./pending";
import { archiveInactiveProfiles } from "./profileLifecycle";
import { makeMemoryId, nowIso, type MemoryItem, type MemoryStore } from "./types";

/**
 * Decaimiento, retención y consolidación programada (sección 5).
 *
 * Proceso idempotente y por lotes: reduce la confianza de recuerdos antiguos
 * poco usados, expira efímeros, archiva episodios viejos irrelevantes y
 * fusiona casi-duplicados. Es seguro reejecutarlo: cada acción es
 * convergente (la confianza no baja de un suelo, expirar dos veces es
 * inocuo) y se marca la ventana ya procesada para no aplicar dos veces en el
 * mismo periodo.
 *
 * Fórmula de decaimiento (documentada, ajustable, testeable):
 *
 *   nuevaConfianza = confianza − step
 *   step = DECAY_BASE
 *          × factorEdad(ageDays)     // 0 si es reciente, →1 con el tiempo
 *          × factorTipo(assertion)   // fact/opinion decaen; instruction menos
 *          × (1 − usoNormalizado)    // lo muy recuperado apenas decae
 *          × (1 − importancia)       // lo importante apenas decae
 *
 * NUNCA se aplica a memorias de seguridad/sistema, ni por debajo de un suelo.
 */

export const DECAY_BASE = 0.15; // caída máxima de confianza por ejecución
export const CONFIDENCE_FLOOR = 0.1; // nunca por debajo de esto por decaimiento
export const DECAY_MIN_AGE_DAYS = 14; // gracia: nada decae en las 2 primeras semanas
export const EPISODIC_ARCHIVE_DAYS = 120; // episodios viejos e irrelevantes se archivan

function ageDays(item: MemoryItem, now: number): number {
  const ref = Date.parse(item.updatedAt || item.createdAt);
  if (!Number.isFinite(ref)) return 0;
  return Math.max(0, (now - ref) / 86_400_000);
}

/** Cuánto pesa la edad en el decaimiento: 0 en la ventana de gracia, →1 al año. */
function ageFactor(days: number): number {
  if (days <= DECAY_MIN_AGE_DAYS) return 0;
  return Math.min(1, (days - DECAY_MIN_AGE_DAYS) / 365);
}

/** Distinto trato por clase de afirmación (instruction se protege más). */
function typeFactor(item: MemoryItem): number {
  switch (item.assertionType) {
    case "instruction":
      return 0.4; // una regla operativa no debe evaporarse sola
    case "fact":
      return 0.8;
    case "opinion":
      return 1; // las opiniones envejecen con normalidad
    case "ephemeral":
      return 1;
    default:
      return 0.9; // unclassified
  }
}

/** Decaimiento determinista (puro). Devuelve la nueva confianza. */
export function decayedConfidence(item: MemoryItem, now: number = Date.now()): number {
  const step =
    DECAY_BASE *
    ageFactor(ageDays(item, now)) *
    typeFactor(item) *
    (1 - Math.min(1, item.accessCount / 20)) *
    (1 - item.importance);
  const next = item.confidence - step;
  return Math.max(CONFIDENCE_FLOOR, Math.round(next * 1000) / 1000);
}

export interface ConsolidationOptions {
  dryRun?: boolean;
  batchSize?: number;
  now?: number;
  /** Ventana de idempotencia: no reprocesar si ya se corrió hace < esto. */
  minIntervalMs?: number;
}

export interface ConsolidationReport {
  ran: boolean;
  dryRun: boolean;
  scanned: number;
  expired: number;
  archivedEpisodic: number;
  decayed: number;
  merged: number;
  pendingExpired: number;
  profilesArchived: number;
  skippedRecentRun: boolean;
  at: string;
}

const runStore = globalThis as unknown as { __helionLastConsolidation?: number };

/**
 * Ejecuta una pasada de consolidación. Idempotente: con `minIntervalMs` no
 * repite dentro de la misma ventana; en `dryRun` no escribe nada y solo
 * cuenta lo que haría.
 */
export async function runConsolidation(
  store: MemoryStore,
  options: ConsolidationOptions = {},
): Promise<ConsolidationReport> {
  const { dryRun = false, batchSize = 200, now = Date.now(), minIntervalMs = 0 } = options;
  const report: ConsolidationReport = {
    ran: false,
    dryRun,
    scanned: 0,
    expired: 0,
    archivedEpisodic: 0,
    decayed: 0,
    merged: 0,
    pendingExpired: 0,
    profilesArchived: 0,
    skippedRecentRun: false,
    at: nowIso(),
  };

  const last = runStore.__helionLastConsolidation ?? 0;
  if (!dryRun && minIntervalMs > 0 && now - last < minIntervalMs) {
    report.skippedRecentRun = true;
    return report;
  }

  const actives = await store.list({ status: "active", limit: batchSize });
  report.scanned = actives.length;
  const absorbed = new Set<string>();

  for (const item of actives) {
    // Seguridad/sistema: intocable por la fórmula.
    if (item.type === "safety" || item.scope === "safety" || item.scope === "system_self") continue;

    // 1) Expiración de efímeros/caducados.
    if (item.expiresAt && Date.parse(item.expiresAt) <= now) {
      report.expired += 1;
      if (!dryRun) {
        await store.update(item.id, { status: "archived" });
        await store.logEvent({ id: makeMemoryId(), action: "expired", memoryId: item.id, reason: "caducado", actor: "system", createdAt: nowIso() });
      }
      absorbed.add(item.id);
      continue;
    }

    // 2) Episodios viejos y poco importantes: al archivo.
    if (
      item.type === "episodic" &&
      ageDays(item, now) > EPISODIC_ARCHIVE_DAYS &&
      item.importance < 0.7 &&
      item.accessCount < 3
    ) {
      report.archivedEpisodic += 1;
      if (!dryRun) {
        await store.update(item.id, { status: "archived" });
        await store.logEvent({ id: makeMemoryId(), action: "archived", memoryId: item.id, reason: "episodio antiguo irrelevante", actor: "system", createdAt: nowIso() });
      }
      absorbed.add(item.id);
      continue;
    }

    // 3) Decaimiento de confianza.
    const next = decayedConfidence(item, now);
    if (next < item.confidence - 1e-6) {
      report.decayed += 1;
      if (!dryRun) {
        await store.update(item.id, { confidence: next });
        await store.logEvent({ id: makeMemoryId(), action: "decayed", memoryId: item.id, reason: `confianza ${item.confidence.toFixed(2)}→${next.toFixed(2)}`, actor: "system", createdAt: nowIso() });
      }
    }
  }

  // 4) Fusión de casi-duplicados (misma clase, misma pertenencia, sim≥0,93).
  for (let i = 0; i < actives.length; i++) {
    const a = actives[i];
    if (absorbed.has(a.id) || !a.embedding || a.type === "safety" || a.scope === "safety") continue;
    for (let j = i + 1; j < actives.length; j++) {
      const b = actives[j];
      if (absorbed.has(b.id) || !b.embedding || a.type !== b.type) continue;
      if (a.ownerProfileId !== b.ownerProfileId || a.scope !== b.scope) continue;
      if (cosineSimilarity(a.embedding, b.embedding) < 0.93) continue;
      report.merged += 1;
      if (!dryRun) {
        await store.update(a.id, {
          importance: Math.max(a.importance, b.importance),
          confidence: Math.max(a.confidence, b.confidence),
          tags: [...new Set([...a.tags, ...b.tags])],
        });
        await store.update(b.id, { status: "archived" });
        await store.addRelation({ id: makeMemoryId(), sourceMemoryId: b.id, targetMemoryId: a.id, relationType: "duplicates", confidence: 0.95, createdAt: nowIso() });
        await store.logEvent({ id: makeMemoryId(), action: "consolidated", memoryId: b.id, reason: `fusionado con ${a.id}`, actor: "system", createdAt: nowIso() });
      }
      absorbed.add(b.id);
    }
  }

  // 5) Pendientes caducadas y perfiles dinámicos inactivos.
  if (!dryRun) {
    report.pendingExpired = await expireStalePending(store, now);
    report.profilesArchived = (await archiveInactiveProfiles(store, now)).archived.length;
  }

  report.ran = true;
  if (!dryRun) runStore.__helionLastConsolidation = now;
  return report;
}
