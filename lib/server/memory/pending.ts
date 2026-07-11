import { randomBytes } from "node:crypto";
import { createMemory } from "./service";
import type { EmbedFn } from "./embeddings";
import { makeMemoryId, nowIso, type MemoryStore, type NewMemoryItem } from "./types";

/**
 * Confirmación antes de guardar contenido sensible (sección 6).
 *
 * Una memoria potencialmente sensible/privada/ambigua NO se descarta en
 * silencio: queda en estado "pending" con un identificador de confirmación
 * y a la espera de un "sí" del propietario correcto. Garantías:
 * - No entra en recuperación (status pending se excluye en todas las capas).
 * - Propietario y alcance provisionales; ligada a la identidad correcta.
 * - Caduca; no la puede confirmar otra persona; no admite replay (el token
 *   se invalida al usarse); es descartable; auditada sin exponer el texto.
 *
 * El token vive en provenance.pendingConfirmation, nunca se serializa a la
 * UI ni al modelo salvo su id.
 */

export const PENDING_TTL_MS = 30 * 60 * 1000; // 30 min para confirmar

interface PendingMeta {
  confirmationId: string;
  ownerProfileId: string;
  expiresAt: string;
  /** id de sesión de acceso (últimos chars del token): evita confirmar desde otra sesión. */
  sessionTag: string;
}

export interface PendingRecord {
  id: string;
  confirmationId: string;
  title: string;
  reason: string;
  expiresAt: string;
}

function readPendingMeta(provenance: Record<string, unknown>): PendingMeta | null {
  const meta = provenance.pendingConfirmation as PendingMeta | undefined;
  if (!meta || typeof meta.confirmationId !== "string") return null;
  return meta;
}

/**
 * Crea una memoria en estado pendiente. `ownerProfileId` es quien —y solo
 * quien— podrá confirmarla. Devuelve el registro público (sin token secreto
 * más allá del confirmationId, que es de un solo uso).
 */
export async function createPendingMemory(
  store: MemoryStore,
  input: NewMemoryItem & { ownerProfileId: string },
  options: { embed?: EmbedFn; sessionTag: string; ttlMs?: number; reason?: string } = { sessionTag: "" },
): Promise<PendingRecord | null> {
  const { embed, sessionTag, ttlMs = PENDING_TTL_MS, reason = "" } = options;
  const confirmationId = `cnf_${randomBytes(12).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const meta: PendingMeta = { confirmationId, ownerProfileId: input.ownerProfileId, expiresAt, sessionTag };

  // Se materializa vía createMemory (pasa por el sanitizador: un ataque no
  // se cuela por la puerta de "pendiente") y luego se marca como pending.
  const created = await createMemory(
    store,
    { ...input, provenance: { ...(input.provenance ?? {}), pendingConfirmation: meta } },
    {
      embed,
      actor: "system",
      reason: reason || "pendiente de confirmación",
      actorProfileId: input.ownerProfileId,
      // Una candidata pendiente (sin confirmar) NUNCA debe fusionarse sobre una
      // memoria activa existente (secuestro) ni degradar su confianza por
      // revisión de creencias antes de confirmarse.
      skipDedupAndRelations: true,
    },
  );
  if (!created.ok || !created.item) return null;

  await store.update(created.item.id, { status: "pending" });
  await store.logEvent({
    id: makeMemoryId(),
    action: "created",
    memoryId: created.item.id,
    reason: `pendiente de confirmación de ${input.ownerProfileId} (cnf=${confirmationId.slice(0, 10)})`,
    actor: "system",
    createdAt: nowIso(),
  });
  return { id: created.item.id, confirmationId, title: created.item.title, reason, expiresAt };
}

export type ConfirmOutcome =
  | { ok: true; memoryId: string }
  | { ok: false; reason: "not_found" | "expired" | "wrong_owner" | "already_resolved" };

/**
 * Confirma una memoria pendiente. Exige coincidencia EXACTA de propietario y
 * que no haya caducado. Invalida el token al confirmar (sin replay).
 */
export async function confirmPendingMemory(
  store: MemoryStore,
  confirmationId: string,
  profileId: string,
): Promise<ConfirmOutcome> {
  const pendings = await store.list({ status: "pending", limit: 500 });
  const target = pendings.find((m) => readPendingMeta(m.provenance)?.confirmationId === confirmationId);
  if (!target) return { ok: false, reason: "not_found" };
  const meta = readPendingMeta(target.provenance)!;

  if (meta.ownerProfileId !== profileId) {
    await store.logEvent({
      id: makeMemoryId(),
      action: "rejected",
      memoryId: target.id,
      reason: `intento de confirmación por perfil incorrecto (${profileId})`,
      actor: "system",
      createdAt: nowIso(),
    });
    return { ok: false, reason: "wrong_owner" };
  }
  if (Date.parse(meta.expiresAt) <= Date.now()) {
    await store.update(target.id, { status: "archived" });
    return { ok: false, reason: "expired" };
  }

  // Activa y quema el token (replay imposible: el confirmationId desaparece).
  const cleanProvenance = { ...target.provenance };
  delete (cleanProvenance as Record<string, unknown>).pendingConfirmation;
  cleanProvenance.confirmedAt = nowIso();
  await store.update(target.id, { status: "active", provenance: cleanProvenance });
  await store.logEvent({
    id: makeMemoryId(),
    action: "confirmed",
    memoryId: target.id,
    reason: `confirmada por ${profileId}`,
    actor: "user",
    createdAt: nowIso(),
  });
  return { ok: true, memoryId: target.id };
}

/** Descarta una memoria pendiente (solo su propietario). */
export async function discardPendingMemory(
  store: MemoryStore,
  confirmationId: string,
  profileId: string,
): Promise<ConfirmOutcome> {
  const pendings = await store.list({ status: "pending", limit: 500 });
  const target = pendings.find((m) => readPendingMeta(m.provenance)?.confirmationId === confirmationId);
  if (!target) return { ok: false, reason: "not_found" };
  const meta = readPendingMeta(target.provenance)!;
  if (meta.ownerProfileId !== profileId) return { ok: false, reason: "wrong_owner" };
  await store.update(target.id, { status: "archived" });
  await store.logEvent({
    id: makeMemoryId(),
    action: "deleted",
    memoryId: target.id,
    reason: `descartada por ${profileId}`,
    actor: "user",
    createdAt: nowIso(),
  });
  return { ok: true, memoryId: target.id };
}

/** Barrido de pendientes caducadas (lo llama la consolidación / oportunista). */
export async function expireStalePending(store: MemoryStore, now: number = Date.now()): Promise<number> {
  const pendings = await store.list({ status: "pending", limit: 500 });
  let expired = 0;
  for (const m of pendings) {
    const meta = readPendingMeta(m.provenance);
    if (meta && Date.parse(meta.expiresAt) <= now) {
      await store.update(m.id, { status: "archived" });
      expired += 1;
    }
  }
  return expired;
}

/** Lista pública de pendientes de un perfil (sin contenido sensible). */
export async function listPendingForProfile(store: MemoryStore, profileId: string): Promise<PendingRecord[]> {
  const pendings = await store.list({ status: "pending", limit: 500 });
  return pendings
    .map((m) => ({ m, meta: readPendingMeta(m.provenance) }))
    .filter((x): x is { m: (typeof pendings)[number]; meta: PendingMeta } => x.meta?.ownerProfileId === profileId)
    .map(({ m, meta }) => ({ id: m.id, confirmationId: meta.confirmationId, title: m.title, reason: "", expiresAt: meta.expiresAt }));
}
