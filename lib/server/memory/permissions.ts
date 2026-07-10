import type { AccessProfile } from "../profiles";

/**
 * Permisos de memoria por perfil. El filtrado ocurre SIEMPRE en servidor,
 * antes del ranking y de construir contexto: una memoria no autorizada
 * jamás llega al modelo ni a la UI del interlocutor.
 */

export type MemoryScope =
  | "private"
  | "project"
  | "project_demo"
  | "public"
  | "system_self"
  | "safety"
  | "internal";

export const MEMORY_SCOPES: MemoryScope[] = [
  "private",
  "project",
  "project_demo",
  "public",
  "system_self",
  "safety",
  "internal",
];

interface ScopedMemory {
  scope: MemoryScope;
  ownerProfileId: string | null;
  allowedProfileIds: string[];
}

export function canProfileAccessMemory(item: ScopedMemory, profile: AccessProfile): boolean {
  switch (item.scope) {
    case "public":
    case "system_self":
      return true;
    case "safety":
      // Siempre disponible para el sistema (reglas de comportamiento).
      return true;
    case "internal":
      // Nunca se expone literalmente a ningún interlocutor.
      return false;
    case "project":
      return (
        profile.memoryScopes.includes("project") || item.allowedProfileIds.includes(profile.id)
      );
    case "project_demo":
      return (
        profile.memoryScopes.includes("project_demo") ||
        profile.memoryScopes.includes("project") ||
        item.allowedProfileIds.includes(profile.id)
      );
    case "private":
    default:
      return item.ownerProfileId === profile.id || item.allowedProfileIds.includes(profile.id);
  }
}

export function filterMemoriesForProfile<T extends ScopedMemory>(items: T[], profile: AccessProfile): T[] {
  return items.filter((item) => canProfileAccessMemory(item, profile));
}

/**
 * Filtro con estado de identidad (sección 7): si el interlocutor solo está
 * SUGERIDO (cookie sin confirmar), lo privado y de proyecto NO se abre aunque
 * el rol lo permita. Solo material público/demo/system_self/safety hasta que
 * confirme. `confirmed=true` restaura el filtrado normal por perfil.
 */
export function filterMemoriesForRetrieval<T extends ScopedMemory>(
  items: T[],
  profile: AccessProfile,
  confirmed: boolean,
): T[] {
  if (confirmed) return filterMemoriesForProfile(items, profile);
  return items.filter((item) => {
    if (item.scope === "public" || item.scope === "system_self" || item.scope === "safety") {
      return canProfileAccessMemory(item, profile);
    }
    if (item.scope === "project_demo") return canProfileAccessMemory(item, profile);
    // private / project / internal: bloqueados sin confirmación.
    return false;
  });
}

/** ¿Puede este perfil borrar/archivar esta memoria? */
export function canProfileManageMemory(item: ScopedMemory & { createdByProfileId: string | null }, profile: AccessProfile): boolean {
  if (item.scope === "safety" || item.scope === "internal") return profile.canManageMemory;
  if (profile.canManageMemory) return true;
  return item.ownerProfileId === profile.id || item.createdByProfileId === profile.id;
}

export interface ScopeCueResult {
  scope: MemoryScope | null;
  confidential: boolean;
}

/**
 * Pistas EXPLÍCITAS de alcance en el texto del usuario. Deterministas:
 * ganan siempre a la clasificación del curador.
 */
export function detectScopeCues(text: string): ScopeCueResult {
  const t = text.toLowerCase();
  if (/no\s+(se\s+lo|le\s+lo|lo)\s+(digas|cuentes|menciones|reveles)|que\s+no\s+(lo\s+)?sepa/.test(t)) {
    return { scope: "private", confidential: true };
  }
  if (/solo\s+(para|entre)\s+(m[ií]|nosotros)|solo\s+yo|privado/.test(t)) {
    return { scope: "private", confidential: false };
  }
  if (/para\s+el\s+proyecto|del\s+proyecto\b/.test(t)) {
    return { scope: "project", confidential: false };
  }
  if (/(puedes?|pod[ée]is)\s+cont[aá]rselo|comp[aá]rte(lo)?\s+con|se\s+lo\s+puedes\s+(contar|decir)/.test(t)) {
    return { scope: "project", confidential: false };
  }
  if (/es\s+p[uú]blico|para\s+la\s+demo/.test(t)) {
    return { scope: "project_demo", confidential: false };
  }
  return { scope: null, confidential: false };
}
