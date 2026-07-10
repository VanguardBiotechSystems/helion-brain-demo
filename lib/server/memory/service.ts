import type { AppEnv } from "../env";
import { logError, logInfo } from "../log";
import { cosineSimilarity, makeEmbedder, type EmbedFn } from "./embeddings";
import { extractMemories, type CuratorInputMessage, type CuratorMemory } from "./curator";
import { LocalMemoryStore } from "./localStore";
import { containsSecret, SECRET_REJECTION_MESSAGE } from "./redaction";
import { buildMemoryContext, rankMemories } from "./scoring";
import { SEED_MEMORIES } from "./seeds";
import {
  makeMemoryId,
  nowIso,
  type MemoryActor,
  type MemoryItem,
  type MemoryStore,
  type MemoryType,
  type NewMemoryItem,
  type ScoredMemory,
} from "./types";

/**
 * Capa de servicio de memoria: deduplicación, extracción, recuperación,
 * olvido y consolidación. Las rutas API son envoltorios finos sobre esto.
 */

const DEDUP_SIMILARITY = 0.92;
const FORGET_MIN_SCORE = 0.35;

const globalStore = globalThis as unknown as { __helionMemoryStore?: MemoryStore };

export async function getMemoryStore(env: AppEnv): Promise<MemoryStore> {
  if (!globalStore.__helionMemoryStore) {
    const store =
      env.memory.provider === "postgres"
        ? new (await import("./postgresStore")).PostgresMemoryStore(env.memory.databaseUrl)
        : new LocalMemoryStore(env.memory.localPath);
    await store.init();
    await seedIfEmpty(store);
    globalStore.__helionMemoryStore = store;
  }
  return globalStore.__helionMemoryStore;
}

async function seedIfEmpty(store: MemoryStore): Promise<void> {
  if ((await store.count()) > 0) return;
  for (const seed of SEED_MEMORIES) {
    const item = materialize(seed);
    await store.create(item);
    await store.logEvent({
      id: makeMemoryId(),
      action: "created",
      memoryId: item.id,
      reason: "memoria inicial del proyecto (seed)",
      actor: "system",
      createdAt: nowIso(),
    });
  }
  logInfo("memory", `Memoria inicial insertada (${SEED_MEMORIES.length} recuerdos seed)`);
}

function materialize(input: NewMemoryItem): MemoryItem {
  const now = nowIso();
  return {
    id: makeMemoryId(),
    profileId: "default",
    type: input.type,
    title: input.title.slice(0, 160),
    content: input.content,
    canonicalContent: (input.canonicalContent ?? input.content).slice(0, 1000),
    summary: input.summary ?? "",
    embedding: input.embedding ?? null,
    importance: input.importance ?? 0.6,
    confidence: input.confidence ?? 0.8,
    source: input.source,
    sensitivity: input.sensitivity ?? "normal",
    status: "active",
    tags: input.tags ?? [],
    relatedEntities: input.relatedEntities ?? [],
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: null,
    accessCount: 0,
    expiresAt: input.expiresAt ?? null,
    provenance: input.provenance ?? {},
    version: 1,
  };
}

export interface CreateMemoryResult {
  ok: boolean;
  item?: MemoryItem;
  deduplicatedInto?: string;
  rejectedReason?: string;
}

/**
 * Crea un recuerdo con las reglas duras: sin secretos y con deduplicación
 * semántica (si ya existe uno muy parecido, se actualiza en vez de crear).
 */
export async function createMemory(
  store: MemoryStore,
  input: NewMemoryItem,
  options: { embed?: EmbedFn; actor?: MemoryActor; reason?: string } = {},
): Promise<CreateMemoryResult> {
  const { embed, actor = "system", reason = "" } = options;
  const text = `${input.title} ${input.content}`;

  if (containsSecret(text)) {
    logInfo("memory", "Guardado rechazado: el contenido parece contener una credencial");
    return { ok: false, rejectedReason: SECRET_REJECTION_MESSAGE };
  }
  if (input.sensitivity === "secret") {
    return { ok: false, rejectedReason: "La sensibilidad 'secret' nunca se almacena." };
  }

  const embedding = input.embedding ?? (embed ? await embed(input.canonicalContent ?? input.content) : null);

  // Deduplicación: embedding si lo hay; si no, coincidencia exacta de contenido.
  const actives = await store.list({ status: "active", limit: 1000 });
  let duplicate: { item: MemoryItem; similarity: number } | null = null;
  for (const candidate of actives) {
    if (embedding && candidate.embedding) {
      const similarity = cosineSimilarity(embedding, candidate.embedding);
      if (similarity >= DEDUP_SIMILARITY && (!duplicate || similarity > duplicate.similarity)) {
        duplicate = { item: candidate, similarity };
      }
    } else if (
      candidate.canonicalContent.trim().toLowerCase() === (input.canonicalContent ?? input.content).trim().toLowerCase()
    ) {
      duplicate = { item: candidate, similarity: 1 };
      break;
    }
  }

  if (duplicate) {
    const updated = await store.update(duplicate.item.id, {
      content: input.content,
      canonicalContent: (input.canonicalContent ?? input.content).slice(0, 1000),
      embedding: embedding ?? duplicate.item.embedding,
      importance: Math.max(duplicate.item.importance, input.importance ?? 0),
      confidence: Math.max(duplicate.item.confidence, input.confidence ?? 0),
      tags: [...new Set([...duplicate.item.tags, ...(input.tags ?? [])])],
    });
    await store.logEvent({
      id: makeMemoryId(),
      action: "updated",
      memoryId: duplicate.item.id,
      reason: reason || `actualizado por deduplicación (similitud ${duplicate.similarity.toFixed(2)})`,
      actor,
      createdAt: nowIso(),
    });
    return { ok: true, item: updated ?? duplicate.item, deduplicatedInto: duplicate.item.id };
  }

  const item = materialize({ ...input, embedding });
  await store.create(item);
  await store.logEvent({
    id: makeMemoryId(),
    action: "created",
    memoryId: item.id,
    reason: reason || `origen: ${input.source}`,
    actor,
    createdAt: nowIso(),
  });
  return { ok: true, item };
}

export interface SearchOptions {
  topK?: number;
  types?: MemoryType[];
  markAccessed?: boolean;
}

export async function searchMemories(
  store: MemoryStore,
  env: AppEnv,
  query: string,
  options: SearchOptions = {},
): Promise<ScoredMemory[]> {
  const { topK = env.memory.retrievalTopK, types, markAccessed = true } = options;
  const embed = makeEmbedder(env);
  const queryEmbedding = query.trim() ? await embed(query) : null;

  let actives = await store.list({ status: "active", limit: 1000 });
  if (types && types.length > 0) actives = actives.filter((item) => types.includes(item.type));

  const ranked = rankMemories(actives, { queryText: query, queryEmbedding }, topK);

  if (markAccessed) {
    for (const { item } of ranked) {
      void store
        .update(item.id, { lastAccessedAt: nowIso(), accessCount: item.accessCount + 1 })
        .catch(() => {});
    }
  }
  return ranked;
}

/** Bloque de contexto para el inicio de sesión (sin consulta concreta). */
export async function buildSessionMemoryContext(store: MemoryStore, env: AppEnv): Promise<string> {
  const actives = await store.list({ status: "active", limit: 500 });
  const ranked = rankMemories(actives, {}, Math.max(env.memory.retrievalTopK, 10));
  const safety = actives.filter((item) => item.type === "safety");
  const selection = [...safety, ...ranked.map((scored) => scored.item)];
  const unique = [...new Map(selection.map((item) => [item.id, item])).values()];
  return buildMemoryContext(unique, 1200);
}

export interface ExtractionResult {
  saved: Array<{ id: string; title: string; type: MemoryType }>;
  skipped: number;
  pendingConfirmation: Array<{ title: string; reason: string }>;
}

/** Flujo del Memory Curator: extraer → validar → filtrar → deduplicar → guardar. */
export async function extractAndStore(
  store: MemoryStore,
  env: AppEnv,
  messages: CuratorInputMessage[],
): Promise<ExtractionResult> {
  const result: ExtractionResult = { saved: [], skipped: 0, pendingConfirmation: [] };
  if (messages.length === 0) return result;

  const candidates: CuratorMemory[] = await extractMemories(env, messages);
  const embed = makeEmbedder(env);

  for (const candidate of candidates) {
    if (candidate.importance < env.memory.minImportance) {
      result.skipped += 1;
      continue;
    }
    if (
      env.memory.requireConfirmationForSensitive &&
      (candidate.sensitivity === "sensitive" || candidate.requiresUserConfirmation)
    ) {
      result.pendingConfirmation.push({ title: candidate.title, reason: candidate.reason });
      continue;
    }
    const created = await createMemory(
      store,
      {
        type: candidate.memoryType,
        title: candidate.title,
        content: candidate.canonicalContent,
        canonicalContent: candidate.canonicalContent,
        importance: candidate.importance,
        confidence: candidate.confidence,
        source: "conversation",
        sensitivity: candidate.sensitivity,
        tags: candidate.tags,
        relatedEntities: candidate.relatedEntities,
        provenance: { curatorReason: candidate.reason, extractedAt: nowIso() },
      },
      { embed, actor: "system", reason: `curador: ${candidate.reason.slice(0, 120)}` },
    );
    if (created.ok && created.item) {
      result.saved.push({ id: created.item.id, title: created.item.title, type: created.item.type });
    } else {
      result.skipped += 1;
    }
  }

  if (env.memory.debug) {
    logInfo(
      "memory",
      `extracción: ${candidates.length} candidatos, ${result.saved.length} guardados, ${result.skipped} descartados`,
    );
  }
  return result;
}

export interface ForgetResult {
  archived: Array<{ id: string; title: string }>;
}

/** Archiva los recuerdos que casan con la petición de olvido del usuario. */
export async function forgetMemories(
  store: MemoryStore,
  env: AppEnv,
  query: string,
  actor: MemoryActor = "user",
): Promise<ForgetResult> {
  const matches = await searchMemories(store, env, query, { topK: 5, markAccessed: false });
  const archived: ForgetResult["archived"] = [];
  for (const { item, score } of matches) {
    if (score < FORGET_MIN_SCORE) continue;
    if (item.type === "safety") continue; // las reglas de seguridad no se olvidan por voz
    await store.update(item.id, { status: "archived" });
    await store.logEvent({
      id: makeMemoryId(),
      action: "archived",
      memoryId: item.id,
      reason: `petición de olvido del usuario: "${query.slice(0, 120)}"`,
      actor,
      createdAt: nowIso(),
    });
    archived.push({ id: item.id, title: item.title });
  }
  return archived.length > 0 ? { archived } : { archived: [] };
}

/** Consolidación: fusiona recuerdos casi idénticos (misma clase, similitud alta). */
export async function consolidateMemories(store: MemoryStore): Promise<{ merged: number }> {
  const actives = await store.list({ status: "active", limit: 400 });
  let merged = 0;
  const absorbed = new Set<string>();

  for (let i = 0; i < actives.length; i++) {
    const a = actives[i];
    if (absorbed.has(a.id) || !a.embedding) continue;
    for (let j = i + 1; j < actives.length; j++) {
      const b = actives[j];
      if (absorbed.has(b.id) || !b.embedding || a.type !== b.type) continue;
      if (cosineSimilarity(a.embedding, b.embedding) < 0.93) continue;

      // Se conserva el más antiguo (a) y se absorbe el más nuevo (b).
      await store.update(a.id, {
        importance: Math.max(a.importance, b.importance),
        confidence: Math.max(a.confidence, b.confidence),
        tags: [...new Set([...a.tags, ...b.tags])],
      });
      await store.update(b.id, { status: "archived" });
      await store.addRelation({
        id: makeMemoryId(),
        sourceMemoryId: b.id,
        targetMemoryId: a.id,
        relationType: "duplicates",
        confidence: 0.95,
        createdAt: nowIso(),
      });
      await store.logEvent({
        id: makeMemoryId(),
        action: "consolidated",
        memoryId: b.id,
        reason: `fusionado con ${a.id}`,
        actor: "system",
        createdAt: nowIso(),
      });
      absorbed.add(b.id);
      merged += 1;
    }
  }
  return { merged };
}

export { makeEmbedder, SECRET_REJECTION_MESSAGE };
export type { CuratorInputMessage };

/** Aplica retención: archiva recuerdos caducados. Se llama de forma oportunista. */
export async function applyRetention(store: MemoryStore, env: AppEnv): Promise<void> {
  if (!env.memory.retentionDays) return;
  try {
    const cutoff = Date.now() - env.memory.retentionDays * 86_400_000;
    const actives = await store.list({ status: "active", limit: 1000 });
    for (const item of actives) {
      const expired =
        (item.expiresAt && Date.parse(item.expiresAt) < Date.now()) ||
        (item.type === "episodic" && Date.parse(item.updatedAt) < cutoff && item.importance < 0.8);
      if (expired) {
        await store.update(item.id, { status: "archived" });
        await store.logEvent({
          id: makeMemoryId(),
          action: "archived",
          memoryId: item.id,
          reason: "retención/caducidad",
          actor: "system",
          createdAt: nowIso(),
        });
      }
    }
  } catch (error) {
    logError("memory", "Fallo aplicando retención", error);
  }
}
