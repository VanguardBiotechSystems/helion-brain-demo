import { timingSafeEqual, createHash } from "node:crypto";

/**
 * Identidad conversacional. El passcode SOLO abre la puerta (Access Gate);
 * la identidad se resuelve DESPUÉS, en conversación ("Soy Sergio"), contra
 * un registro de perfiles conocidos por alias. Un único Helion compartido:
 * la memoria es común pero segmentada por la identidad actual.
 */

export type ProfileRole = "owner" | "robot_creator" | "investor" | "team" | "visitor";
export type TrustLevel = "owner" | "project_member" | "visitor";
export type IdentityStatus = "unknown" | "claimed" | "confirmed" | "guest";

export interface AccessProfile {
  id: string;
  displayName: string;
  aliases: string[];
  role: ProfileRole;
  trustLevel: TrustLevel;
  memoryScopes: string[];
  canManageMemory: boolean;
  canViewDebug: boolean;
  canCreateProjectMemory: boolean;
  /** Perfil sensible: reclamar esta identidad puede exigir PIN. */
  requiresPin: boolean;
}

const ROLE_DEFAULTS: Record<ProfileRole, Pick<AccessProfile, "trustLevel" | "memoryScopes" | "canManageMemory" | "canViewDebug" | "canCreateProjectMemory" | "requiresPin">> = {
  owner: { trustLevel: "owner", memoryScopes: ["project", "project_demo", "public", "system_self", "safety"], canManageMemory: true, canViewDebug: true, canCreateProjectMemory: true, requiresPin: true },
  robot_creator: { trustLevel: "project_member", memoryScopes: ["project", "project_demo", "public", "system_self", "safety"], canManageMemory: false, canViewDebug: false, canCreateProjectMemory: true, requiresPin: false },
  team: { trustLevel: "project_member", memoryScopes: ["project", "project_demo", "public", "system_self"], canManageMemory: false, canViewDebug: false, canCreateProjectMemory: true, requiresPin: false },
  investor: { trustLevel: "visitor", memoryScopes: ["project_demo", "public", "system_self"], canManageMemory: false, canViewDebug: false, canCreateProjectMemory: false, requiresPin: false },
  visitor: { trustLevel: "visitor", memoryScopes: ["project_demo", "public", "system_self"], canManageMemory: false, canViewDebug: false, canCreateProjectMemory: false, requiresPin: false },
};

const VALID_ROLES: ProfileRole[] = ["owner", "robot_creator", "investor", "team", "visitor"];

function makeProfile(id: string, displayName: string, role: ProfileRole, aliases: string[]): AccessProfile {
  return { id, displayName, aliases, role, ...ROLE_DEFAULTS[role] };
}

const DEFAULT_PROFILES: AccessProfile[] = [
  makeProfile("juanma", "Juanma", "owner", ["juanma", "juan manuel", "juanma otra vez"]),
  makeProfile("sergio", "Sergio", "robot_creator", ["sergio", "el creador del robot", "el del robot"]),
  makeProfile("investor", "Inversor invitado", "investor", ["inversor", "investor", "un inversor"]),
  makeProfile("guest", "Visitante", "visitor", ["visitante", "invitado", "prefiero no decirlo", "guest"]),
];

export interface ProfilesResult {
  profiles: AccessProfile[];
  error: string | null;
}

/** Registro de perfiles conocidos: defaults + KNOWN_PROFILES_JSON (extiende/pisa). */
export function resolveProfiles(source: Record<string, string | undefined>): ProfilesResult {
  const byId = new Map(DEFAULT_PROFILES.map((p) => [p.id, { ...p, aliases: [...p.aliases] }]));
  const json = source.KNOWN_PROFILES_JSON?.trim();
  if (json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { profiles: [], error: "KNOWN_PROFILES_JSON no es JSON válido" };
    }
    if (!Array.isArray(parsed)) return { profiles: [], error: "KNOWN_PROFILES_JSON debe ser un array" };
    for (const raw of parsed) {
      const entry = raw as Record<string, unknown>;
      const id = typeof entry.id === "string" ? entry.id.trim().toLowerCase() : "";
      if (!id) return { profiles: [], error: "Perfil sin 'id' en KNOWN_PROFILES_JSON" };
      const existing = byId.get(id);
      const role = VALID_ROLES.includes(entry.role as ProfileRole)
        ? (entry.role as ProfileRole)
        : (existing?.role ?? "visitor");
      const base = existing ?? makeProfile(id, id, role, [id]);
      byId.set(id, {
        ...base,
        role,
        ...ROLE_DEFAULTS[role],
        displayName: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : base.displayName,
        aliases: Array.isArray(entry.aliases)
          ? [id, ...entry.aliases.filter((a): a is string => typeof a === "string")]
          : base.aliases,
        canManageMemory: typeof entry.canManageMemory === "boolean" ? entry.canManageMemory : ROLE_DEFAULTS[role].canManageMemory,
        canViewDebug: typeof entry.canViewDebug === "boolean" ? entry.canViewDebug : ROLE_DEFAULTS[role].canViewDebug,
      });
    }
  }
  return { profiles: [...byId.values()], error: null };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resuelve un perfil conocido a partir de "soy sergio", "sergio, el del robot"… */
export function matchProfileByAlias(profiles: AccessProfile[], claim: string): AccessProfile | null {
  const text = normalize(claim).replace(/^(soy|me llamo|aqui|habla|ahora estas hablando con|cambia a( perfil)?)\s+/g, "");
  if (!text) return null;
  for (const profile of profiles) {
    for (const alias of [profile.id, profile.displayName, ...profile.aliases]) {
      const a = normalize(alias);
      if (a && (text === a || text.startsWith(`${a} `) || text.includes(` ${a}`) || text.includes(a))) {
        return profile;
      }
    }
  }
  return null;
}

/** Perfil efectivo por id: conocido, o dinámico de visitante si se permite. */
export function getProfileById(
  profiles: AccessProfile[],
  id: string | null,
  allowDynamic = true,
): AccessProfile | null {
  if (!id) return null;
  const known = profiles.find((p) => p.id === id);
  if (known) return known;
  if (!allowDynamic || !/^[a-z0-9_-]{2,40}$/.test(id)) return null;
  // Perfil dinámico (persona nueva): visitante con su propia memoria privada.
  return makeProfile(id, id.charAt(0).toUpperCase() + id.slice(1), "visitor", [id]);
}

export function slugifyProfileId(name: string): string {
  return normalize(name).replace(/\s+/g, "-").slice(0, 40) || "guest";
}

/** Comparación en tiempo constante del PIN de owner. */
export function ownerPinMatches(expected: string, provided: string): boolean {
  if (!expected || typeof provided !== "string" || provided.length === 0 || provided.length > 128) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

/** Passcodes que abren la puerta (acceso, NO identidad). */
export function gatePasscodes(source: Record<string, string | undefined>): string[] {
  return [
    source.APP_ACCESS_PASSWORD,
    // Legado (deprecados como identidad): siguen abriendo la puerta.
    source.OWNER_PASSCODE,
    source.SERGIO_PASSCODE,
    source.INVESTOR_PASSCODE,
  ]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
}

export function matchGatePasscode(passcodes: string[], provided: string): boolean {
  if (typeof provided !== "string" || provided.length === 0 || provided.length > 512) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  let ok = false;
  for (const passcode of passcodes) {
    const expected = createHash("sha256").update(passcode).digest();
    if (timingSafeEqual(providedHash, expected)) ok = true;
  }
  return ok;
}
