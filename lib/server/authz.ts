import type { AccessProfile, ProfileRole, IdentityStatus } from "./profiles";

/**
 * Matriz de autorización CENTRALIZADA (sección 8). En lugar de repartir
 * `if (role === "owner")` por los endpoints, todo permiso se decide aquí a
 * partir de (rol, estado de identidad). Los tests parametrizados
 * (tests/authz.test.ts) recorren la matriz entera.
 *
 * Cuatro planos de identidad, deliberadamente separados:
 * - accessSession: pasó la puerta (passcode). No implica saber quién es.
 * - suggested: hay un perfil probable (cookie), sin confirmar.
 * - confirmed: el interlocutor confirmó su identidad.
 * - privileged: confirmado Y con el factor exigido (PIN para owner).
 */

export type Capability =
  | "read_private_memory" // memorias privadas del propio perfil
  | "read_project_memory" // memorias de proyecto
  | "create_project_memory"
  | "manage_memory" // archivar/olvidar de otros, consolidar
  | "view_debug" // consola técnica
  | "view_tech_status" // estado técnico/salud/system_self ampliado
  | "admin_profiles" // listar/archivar/fusionar perfiles
  | "consolidate_memory"; // disparo manual de consolidación

/** Estado de identidad efectivo derivado del rol + IdentityStatus firmado. */
export type IdentityPlane = "access" | "suggested" | "confirmed" | "privileged";

export function identityPlane(profile: AccessProfile, status: IdentityStatus): IdentityPlane {
  if (status === "unknown") return "access";
  if (status === "claimed" || status === "guest") return "suggested";
  // confirmed: para owner, "privileged" exige que el perfil no requiera un
  // PIN pendiente. resolve/route ya garantiza que owner sin PIN nunca llega a
  // "confirmed"; por eso confirmed+owner = privileged.
  if (status === "confirmed") return profile.role === "owner" ? "privileged" : "confirmed";
  return "access";
}

/**
 * Capacidades por rol en su MÁXIMO plano (confirmado/privilegiado). El plano
 * efectivo puede recortarlas: una identidad solo "suggested" no lee lo
 * privado aunque el rol lo permita.
 */
const ROLE_CAPS: Record<ProfileRole, Capability[]> = {
  owner: [
    "read_private_memory", "read_project_memory", "create_project_memory",
    "manage_memory", "view_debug", "view_tech_status", "admin_profiles", "consolidate_memory",
  ],
  robot_creator: ["read_private_memory", "read_project_memory", "create_project_memory", "view_tech_status"],
  technician: ["view_tech_status"],
  team: ["read_private_memory", "read_project_memory", "create_project_memory"],
  investor: [],
  visitor: [],
};

/** Capacidades que exigen el plano "privileged" (owner con step-up). */
const PRIVILEGED_ONLY: Set<Capability> = new Set([
  "manage_memory", "view_debug", "admin_profiles", "consolidate_memory",
]);

/** Capacidades que exigen al menos "confirmed" (no valen con solo "suggested"). */
const CONFIRMED_ONLY: Set<Capability> = new Set([
  "read_private_memory", "read_project_memory", "create_project_memory",
]);

/**
 * ¿Puede este perfil, en este estado de identidad, ejercer la capacidad?
 * Única fuente de verdad de permisos.
 */
export function can(profile: AccessProfile, status: IdentityStatus, capability: Capability): boolean {
  const caps = ROLE_CAPS[profile.role] ?? [];
  if (!caps.includes(capability)) return false;
  const plane = identityPlane(profile, status);
  if (PRIVILEGED_ONLY.has(capability)) return plane === "privileged";
  if (CONFIRMED_ONLY.has(capability)) return plane === "confirmed" || plane === "privileged";
  // view_tech_status: basta con identidad confirmada del rol técnico/creador/owner.
  return plane === "confirmed" || plane === "privileged";
}

/** Lista de capacidades activas (para el panel de debug / /api/identity/current). */
export function activeCapabilities(profile: AccessProfile, status: IdentityStatus): Capability[] {
  return (ROLE_CAPS[profile.role] ?? []).filter((c) => can(profile, status, c));
}

/**
 * ¿Debe cargarse memoria privada/de proyecto en la recuperación? Solo con
 * identidad CONFIRMADA. Una cookie que "sugiere" a Juanma no abre lo privado
 * hasta que él confirme (sección 7).
 */
export function canRetrievePrivate(profile: AccessProfile, status: IdentityStatus): boolean {
  return can(profile, status, "read_private_memory");
}
