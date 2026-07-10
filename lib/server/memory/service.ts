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
  visibilityForScope,
  type MemoryActor,
  type MemoryItem,
  type MemoryStore,
  type MemoryType,
  type NewMemoryItem,
  type ScoredMemory,
} from "./types";
import { canProfileAccessMemory, detectScopeCues, filterMemoriesForProfile } from "./permissions";
import type { AccessProfile } from "../profiles";

/** Último error de memoria (seguro, sin secretos) para /api/memory/health. */
let lastMemoryError: { message: string; at: string } | null = null;
export function recordMemoryError(message: string): void {
  lastMemoryError = { message: message.slice(0, 200), at: nowIso() };
}
export function getLastMemoryError(): { message: string; at: string } | null {
  return lastMemoryError;
}

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
  const scope = input.scope ?? "project_demo";
  return {
    id: makeMemoryId(),
    profileId: "default",
    scope,
    visibility: visibilityForScope(scope),
    ownerProfileId: input.ownerProfileId ?? (scope === "private" ? (input.createdByProfileId ?? null) : null),
    createdByProfileId: input.createdByProfileId ?? null,
    allowedProfileIds: input.allowedProfileIds ?? [],
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
  /** Perfil del interlocutor: el filtrado de permisos es OBLIGATORIO aquí. */
  profile?: AccessProfile;
}

export async function searchMemories(
  store: MemoryStore,
  env: AppEnv,
  query: string,
  options: SearchOptions = {},
): Promise<ScoredMemory[]> {
  const { topK = env.memory.retrievalTopK, types, markAccessed = true, profile } = options;
  const embed = makeEmbedder(env);
  const queryEmbedding = query.trim() ? await embed(query) : null;

  let actives = await store.list({ status: "active", limit: 1000 });
  // El filtrado por perfil ocurre ANTES del ranking: lo no autorizado no
  // existe para este interlocutor.
  if (profile) actives = filterMemoriesForProfile(actives, profile);
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

/** Bloque de contexto para el inicio de sesión, filtrado por perfil. */
export async function buildSessionMemoryContext(
  store: MemoryStore,
  env: AppEnv,
  profile?: AccessProfile,
): Promise<string> {
  let actives = await store.list({ status: "active", limit: 500 });
  if (profile) actives = filterMemoriesForProfile(actives, profile);
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
  profile?: AccessProfile,
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
    // Alcance: las pistas explícitas del usuario ganan al curador; sin
    // permiso de memoria de proyecto, lo compartible baja a project_demo
    // y, si tampoco procede, a privado del hablante.
    const cues = detectScopeCues(candidate.canonicalContent);
    let scope = cues.scope ?? candidate.proposedScope ?? env.memory.defaultScope;
    if ((scope === "project" || scope === "project_demo") && profile && !profile.canCreateProjectMemory) {
      scope = "private";
    }
    const created = await createMemory(
      store,
      {
        scope,
        ownerProfileId: scope === "private" ? (profile?.id ?? null) : null,
        createdByProfileId: profile?.id ?? null,
        type: candidate.memoryType,
        title: candidate.title,
        content: candidate.canonicalContent,
        canonicalContent: candidate.canonicalContent,
        importance: candidate.importance,
        confidence: candidate.confidence,
        source: "conversation",
        sensitivity: cues.confidential ? "private" : candidate.sensitivity,
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
  profile?: AccessProfile,
): Promise<ForgetResult> {
  const matches = await searchMemories(store, env, query, { topK: 5, markAccessed: false, profile });
  const archived: ForgetResult["archived"] = [];
  for (const { item, score } of matches) {
    if (score < FORGET_MIN_SCORE) continue;
    if (item.type === "safety" || item.scope === "safety") continue; // las reglas de seguridad no se olvidan por voz
    // Sin permiso de gestión, solo se olvida lo propio.
    if (profile && !profile.canManageMemory && item.ownerProfileId !== profile.id && item.createdByProfileId !== profile.id) {
      continue;
    }
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

export { makeEmbedder, SECRET_REJECTION_MESSAGE, canProfileAccessMemory, filterMemoriesForProfile };
export type { CuratorInputMessage };

export interface MemoryHealth {
  enabled: boolean;
  providerConfigured: string;
  providerEffective: string;
  databaseUrlPresent: boolean;
  connectionOk: boolean;
  activeMemories: number;
  lastCreatedAt: string | null;
  readLatencyMs: number | null;
  serverless: boolean;
  ephemeral: boolean;
  persistent: boolean;
  lastError: { message: string; at: string } | null;
}

/**
 * Diagnóstico honesto de persistencia: si Postgres no responde o el store
 * local no puede escribir en disco (serverless), lo dice — Helion no debe
 * fingir que recuerda.
 */
export async function getMemoryHealth(env: AppEnv): Promise<MemoryHealth> {
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const base: MemoryHealth = {
    enabled: env.memory.enabled,
    providerConfigured: env.memory.provider,
    providerEffective: "disabled",
    databaseUrlPresent: Boolean(env.memory.databaseUrl),
    connectionOk: false,
    activeMemories: 0,
    lastCreatedAt: null,
    readLatencyMs: null,
    serverless,
    ephemeral: true,
    persistent: false,
    lastError: getLastMemoryError(),
  };
  if (!env.memory.enabled) return base;

  try {
    const store = await getMemoryStore(env);
    const start = Date.now();
    const actives = await store.list({ status: "active", limit: 1000 });
    base.readLatencyMs = Date.now() - start;
    base.connectionOk = true;
    base.providerEffective = store.provider;
    base.activeMemories = actives.length;
    base.lastCreatedAt = actives.reduce<string | null>(
      (latest, item) => (!latest || item.createdAt > latest ? item.createdAt : latest),
      null,
    );
    const localPersistable =
      store instanceof LocalMemoryStore ? store.isPersistable() && !serverless : false;
    base.persistent = store.provider === "postgres" ? true : localPersistable;
    base.ephemeral = !base.persistent;
  } catch (error) {
    recordMemoryError(error instanceof Error ? error.message : "fallo desconocido de memoria");
    base.lastError = getLastMemoryError();
    logError("memory", "health: el almacén no responde", error);
  }
  return base;
}

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
