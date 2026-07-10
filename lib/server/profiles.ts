import { timingSafeEqual, createHash } from "node:crypto";

/**
 * Identidad de interlocutor: perfiles de acceso por passcode.
 * El passcode identifica al perfil (Juanma/Sergio/inversor/visitante); el
 * servidor resuelve identidad, rol y scopes de memoria. El cliente jamás
 * puede autoasignarse un perfil.
 */

export type ProfileRole = "owner" | "robot_creator" | "investor" | "team" | "visitor";

export interface AccessProfile {
  id: string;
  displayName: string;
  role: ProfileRole;
  passcode: string;
  /** Scopes de memoria accesibles (la privada propia siempre lo es). */
  memoryScopes: string[];
  canManageMemory: boolean;
  canViewDebug: boolean;
  canCreateProjectMemory: boolean;
}

const ROLE_DEFAULTS: Record<ProfileRole, Omit<AccessProfile, "id" | "displayName" | "passcode" | "role">> = {
  owner: {
    memoryScopes: ["project", "project_demo", "public", "system_self", "safety"],
    canManageMemory: true,
    canViewDebug: true,
    canCreateProjectMemory: true,
  },
  robot_creator: {
    memoryScopes: ["project", "project_demo", "public", "system_self", "safety"],
    canManageMemory: false,
    canViewDebug: false,
    canCreateProjectMemory: true,
  },
  team: {
    memoryScopes: ["project", "project_demo", "public", "system_self"],
    canManageMemory: false,
    canViewDebug: false,
    canCreateProjectMemory: true,
  },
  investor: {
    memoryScopes: ["project_demo", "public", "system_self"],
    canManageMemory: false,
    canViewDebug: false,
    canCreateProjectMemory: false,
  },
  visitor: {
    memoryScopes: ["project_demo", "public", "system_self"],
    canManageMemory: false,
    canViewDebug: false,
    canCreateProjectMemory: false,
  },
};

const VALID_ROLES: ProfileRole[] = ["owner", "robot_creator", "investor", "team", "visitor"];

export interface ProfilesResult {
  profiles: AccessProfile[];
  error: string | null;
}

/**
 * Resuelve los perfiles desde el entorno. Prioridad:
 * 1) ACCESS_PROFILES_JSON (estructura extensible; passcodes inline o vía
 *    passcodeEnv apuntando a otra variable — recomendado en Vercel).
 * 2) Variables simples OWNER_PASSCODE / SERGIO_PASSCODE / INVESTOR_PASSCODE.
 * 3) APP_ACCESS_PASSWORD → perfil visitante genérico (compatibilidad).
 * Falla con mensaje claro si el JSON es inválido o hay passcodes duplicados.
 */
export function resolveProfiles(source: Record<string, string | undefined>): ProfilesResult {
  const profiles: AccessProfile[] = [];

  const json = source.ACCESS_PROFILES_JSON?.trim();
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { profiles: [], error: "ACCESS_PROFILES_JSON no es JSON válido" };
    }
    if (!Array.isArray(parsed)) {
      return { profiles: [], error: "ACCESS_PROFILES_JSON debe ser un array de perfiles" };
    }
    for (const raw of parsed) {
      const entry = raw as Record<string, unknown>;
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const role = VALID_ROLES.includes(entry.role as ProfileRole) ? (entry.role as ProfileRole) : "visitor";
      const passcodeEnv = typeof entry.passcodeEnv === "string" ? entry.passcodeEnv : "";
      const passcode =
        (typeof entry.passcode === "string" && entry.passcode.trim()) ||
        (passcodeEnv ? source[passcodeEnv]?.trim() : "") ||
        "";
      if (!id) return { profiles: [], error: "Perfil sin 'id' en ACCESS_PROFILES_JSON" };
      if (!passcode) {
        return {
          profiles: [],
          error: `Perfil '${id}' sin passcode (define 'passcode' o 'passcodeEnv' + su variable)`,
        };
      }
      const defaults = ROLE_DEFAULTS[role];
      profiles.push({
        id,
        displayName: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : id,
        role,
        passcode,
        memoryScopes: Array.isArray(entry.memoryScopes)
          ? entry.memoryScopes.filter((s): s is string => typeof s === "string")
          : defaults.memoryScopes,
        canManageMemory:
          typeof entry.canManageMemory === "boolean" ? entry.canManageMemory : defaults.canManageMemory,
        canViewDebug: typeof entry.canViewDebug === "boolean" ? entry.canViewDebug : defaults.canViewDebug,
        canCreateProjectMemory:
          typeof entry.canCreateProjectMemory === "boolean"
            ? entry.canCreateProjectMemory
            : defaults.canCreateProjectMemory,
      });
    }
  } else {
    const simple: Array<[string | undefined, string, string, ProfileRole]> = [
      [source.OWNER_PASSCODE, "juanma", "Juanma", "owner"],
      [source.SERGIO_PASSCODE, "sergio", "Sergio", "robot_creator"],
      [source.INVESTOR_PASSCODE, "investor", "Invitado inversor", "investor"],
    ];
    for (const [passcode, id, displayName, role] of simple) {
      if (passcode?.trim()) {
        profiles.push({ id, displayName, role, passcode: passcode.trim(), ...ROLE_DEFAULTS[role] });
      }
    }
  }

  // Compatibilidad: APP_ACCESS_PASSWORD como perfil visitante genérico.
  const legacy = source.APP_ACCESS_PASSWORD?.trim();
  if (legacy && !profiles.some((p) => p.passcode === legacy)) {
    profiles.push({
      id: "guest",
      displayName: "Visitante",
      role: "visitor",
      passcode: legacy,
      ...ROLE_DEFAULTS.visitor,
    });
  }

  // Passcodes duplicados = identidad ambigua: error claro.
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.passcode)) {
      return { profiles: [], error: `Passcode duplicado entre perfiles ('${profile.id}')` };
    }
    seen.add(profile.passcode);
  }

  return { profiles, error: null };
}

/** Compara en tiempo constante contra todos los perfiles. */
export function matchProfileByPasscode(profiles: AccessProfile[], provided: string): AccessProfile | null {
  if (typeof provided !== "string" || provided.length === 0 || provided.length > 512) return null;
  const providedHash = createHash("sha256").update(provided).digest();
  let matched: AccessProfile | null = null;
  for (const profile of profiles) {
    const expectedHash = createHash("sha256").update(profile.passcode).digest();
    if (timingSafeEqual(providedHash, expectedHash)) matched = profile;
  }
  return matched;
}

export function getProfileById(profiles: AccessProfile[], id: string | null): AccessProfile | null {
  if (!id) return null;
  return profiles.find((profile) => profile.id === id) ?? null;
}
