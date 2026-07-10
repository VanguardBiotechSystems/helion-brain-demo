import type { MemoryStore, ProfileRecord } from "./types";

/**
 * Ciclo de vida de perfiles dinámicos (sección 9). El listado y el archivo
 * por inactividad son obligatorios; la fusión queda documentada como contrato
 * pendiente (ver mergeProfiles más abajo) por exigir una transacción segura
 * que no aporta valor inmediato a la demo.
 */

export const PROFILE_INACTIVE_DAYS = 30;

/** Archiva perfiles dinámicos sin uso en ~30 días (los fijados nunca). */
export async function archiveInactiveProfiles(
  store: MemoryStore,
  now: number = Date.now(),
  inactiveDays: number = PROFILE_INACTIVE_DAYS,
): Promise<{ archived: string[] }> {
  const cutoff = now - inactiveDays * 86_400_000;
  const profiles = await store.listProfiles();
  const archived: string[] = [];
  for (const p of profiles) {
    if (p.status !== "active" || p.pinned || p.origin === "known") continue;
    if (Date.parse(p.lastUsedAt) < cutoff) {
      await store.setProfileStatus(p.id, "archived");
      archived.push(p.id);
    }
  }
  return { archived };
}

/** Restaura manualmente un perfil archivado. */
export async function restoreProfile(store: MemoryStore, id: string): Promise<void> {
  await store.setProfileStatus(id, "active");
}

/** Vista pública de perfiles para el panel de owner (sin datos sensibles). */
export async function listProfilesForOwner(store: MemoryStore): Promise<ProfileRecord[]> {
  return store.listProfiles();
}

/**
 * Fusión de perfiles: CONTRATO preparado, no implementado. Requiere una
 * transacción que migre memorias conservando ownership y relaciones, resuelva
 * colisiones, no degrade scopes, sea reversible y nunca fusione contra owner.
 * El almacén local no es transaccional y Postgres exigiría un procedimiento
 * dedicado; se deja explícito para no dar una falsa sensación de seguridad.
 */
export async function mergeProfiles(): Promise<never> {
  throw new Error(
    "La fusión de perfiles no está implementada: exige una transacción segura (owner-only, dry-run, " +
      "migración con ownership/relaciones, sin degradar scopes, reversible). Contrato documentado.",
  );
}
