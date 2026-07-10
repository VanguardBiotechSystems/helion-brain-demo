/** Modelo de datos de la memoria persistente de Helion. */

export type MemoryType =
  | "episodic"
  | "semantic"
  | "preference"
  | "person"
  | "project"
  | "procedural"
  | "safety";

export type MemorySensitivity = "normal" | "private" | "sensitive" | "secret";
/** "pending" = a la espera de confirmación del dueño: NUNCA entra en recuperación. */
export type MemoryStatus = "active" | "archived" | "deleted" | "pending";

/**
 * Clase de afirmación que contiene el recuerdo. Gobierna curación, ranking
 * y retención:
 * - fact: describe una realidad relativamente estable (puede quedar desactualizado).
 * - opinion: preferencia/valoración de una persona (evoluciona; nunca hecho universal).
 * - instruction: petición atribuida a una persona. NO es una orden del sistema:
 *   conserva procedencia y jamás pisa seguridad, permisos ni personalidad.
 * - ephemeral: ligado a un periodo corto; lleva expiresAt (48 h por defecto).
 * - unclassified: estado explícito para lo heredado o dudoso (backfill conservador).
 */
export type MemoryAssertionType = "fact" | "opinion" | "instruction" | "ephemeral" | "unclassified";
export type MemorySource = "conversation" | "explicit_user_request" | "system" | "manual" | "inferred";
export type MemoryActor = "system" | "user" | "admin";

export type MemoryRelationType =
  | "supports"
  | "contradicts"
  | "updates"
  | "supersedes"
  | "duplicates"
  | "related_to"
  | "caused_by"
  | "preference_for"
  | "belongs_to_person"
  | "belongs_to_project";

export type MemoryScope =
  | "private"
  | "project"
  | "project_demo"
  | "public"
  | "system_self"
  | "safety"
  | "internal";

export type MemoryVisibility = "private" | "shared" | "public" | "internal";

export interface MemoryItem {
  id: string;
  profileId: string;
  /** Alcance de compartición (filtrado en servidor por perfil). */
  scope: MemoryScope;
  visibility: MemoryVisibility;
  /** Propietario si es privada. */
  ownerProfileId: string | null;
  createdByProfileId: string | null;
  /** Perfiles adicionales autorizados explícitamente. */
  allowedProfileIds: string[];
  type: MemoryType;
  assertionType: MemoryAssertionType;
  title: string;
  content: string;
  canonicalContent: string;
  summary: string;
  embedding: number[] | null;
  importance: number;
  confidence: number;
  source: MemorySource;
  sensitivity: MemorySensitivity;
  status: MemoryStatus;
  tags: string[];
  relatedEntities: string[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
  expiresAt: string | null;
  provenance: Record<string, unknown>;
  version: number;
}

export interface NewMemoryItem {
  scope?: MemoryScope;
  ownerProfileId?: string | null;
  createdByProfileId?: string | null;
  allowedProfileIds?: string[];
  type: MemoryType;
  assertionType?: MemoryAssertionType;
  title: string;
  content: string;
  canonicalContent?: string;
  summary?: string;
  embedding?: number[] | null;
  importance?: number;
  confidence?: number;
  source: MemorySource;
  sensitivity?: MemorySensitivity;
  tags?: string[];
  relatedEntities?: string[];
  expiresAt?: string | null;
  provenance?: Record<string, unknown>;
}

export interface MemoryRelation {
  id: string;
  sourceMemoryId: string;
  targetMemoryId: string;
  relationType: MemoryRelationType;
  confidence: number;
  createdAt: string;
}

export type MemoryEventAction =
  | "created"
  | "updated"
  | "retrieved"
  | "archived"
  | "deleted"
  | "consolidated"
  | "rejected"
  | "confirmed"
  | "expired"
  | "decayed";

export interface MemoryEvent {
  id: string;
  action: MemoryEventAction;
  memoryId: string;
  reason: string;
  actor: MemoryActor;
  createdAt: string;
}

export interface MemoryListFilter {
  status?: MemoryStatus | "all";
  type?: MemoryType;
  query?: string;
  limit?: number;
}

export interface ScoredMemory {
  item: MemoryItem;
  score: number;
}

/** Metadatos de ciclo de vida de un perfil (sección 9). */
export interface ProfileRecord {
  id: string;
  displayName: string;
  role: string;
  /** "known" (registro fijo) | "dynamic" (creado al identificarse). */
  origin: "known" | "dynamic";
  status: "active" | "archived";
  /** Fijado: no se archiva por inactividad. */
  pinned: boolean;
  createdAt: string;
  lastUsedAt: string;
  /** Nº de memorias cuyo dueño es este perfil (informativo; puede faltar). */
  memoryCount?: number;
}

export interface MemoryStore {
  readonly provider: "local" | "postgres";
  init(): Promise<void>;
  count(): Promise<number>;
  get(id: string): Promise<MemoryItem | null>;
  create(item: MemoryItem): Promise<MemoryItem>;
  update(id: string, patch: Partial<MemoryItem>): Promise<MemoryItem | null>;
  list(filter?: MemoryListFilter): Promise<MemoryItem[]>;
  addRelation(relation: MemoryRelation): Promise<void>;
  logEvent(event: MemoryEvent): Promise<void>;
  listEvents(memoryId?: string, limit?: number): Promise<MemoryEvent[]>;
  /** Ciclo de vida de perfiles dinámicos. */
  recordProfileUsage(record: { id: string; displayName: string; role: string; origin: "known" | "dynamic" }): Promise<void>;
  listProfiles(): Promise<ProfileRecord[]>;
  setProfileStatus(id: string, status: "active" | "archived"): Promise<void>;
}

export function visibilityForScope(scope: MemoryScope): MemoryVisibility {
  if (scope === "private") return "private";
  if (scope === "public") return "public";
  if (scope === "internal" || scope === "safety" || scope === "system_self") return "internal";
  return "shared";
}

/**
 * Migración de memorias antiguas sin scope: las seeds del sistema pasan a
 * safety/project_demo; el resto queda PRIVADO del perfil owner hasta que
 * alguien lo reclasifique — nunca se exponen a Sergio por accidente.
 */
export function migrateLegacyScopes(item: MemoryItem, ownerProfileId: string): MemoryItem {
  if (item.scope) return item;
  const scope: MemoryScope =
    item.source === "system" ? (item.type === "safety" ? "safety" : "project_demo") : "private";
  return {
    ...item,
    scope,
    visibility: visibilityForScope(scope),
    ownerProfileId: scope === "private" ? ownerProfileId : null,
    createdByProfileId: item.source === "system" ? "system" : ownerProfileId,
    allowedProfileIds: item.allowedProfileIds ?? [],
  };
}

export const ASSERTION_TYPES: MemoryAssertionType[] = ["fact", "opinion", "instruction", "ephemeral", "unclassified"];

/**
 * Backfill conservador de assertionType para memorias anteriores a la
 * migración: preference → opinion (semántica directa), seeds del sistema →
 * fact (curadas a mano), y todo lo demás → "unclassified" explícito.
 * NUNCA se clasifica masivamente como fact: unclassified se trata como
 * no-autoritativo en ranking y retención.
 */
export function backfillAssertionType(item: { assertionType?: MemoryAssertionType; type: MemoryType; source: MemorySource }): MemoryAssertionType {
  if (item.assertionType && ASSERTION_TYPES.includes(item.assertionType)) return item.assertionType;
  if (item.type === "preference") return "opinion";
  if (item.source === "system") return "fact";
  return "unclassified";
}

export function makeMemoryId(): string {
  return `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
