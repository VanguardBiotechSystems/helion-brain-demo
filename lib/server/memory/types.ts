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
export type MemoryStatus = "active" | "archived" | "deleted";
export type MemorySource = "conversation" | "explicit_user_request" | "system" | "manual" | "inferred";
export type MemoryActor = "system" | "user" | "admin";

export type MemoryRelationType =
  | "supports"
  | "contradicts"
  | "updates"
  | "duplicates"
  | "related_to"
  | "caused_by"
  | "preference_for"
  | "belongs_to_person"
  | "belongs_to_project";

export interface MemoryItem {
  id: string;
  profileId: string;
  type: MemoryType;
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
  type: MemoryType;
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

export type MemoryEventAction = "created" | "updated" | "retrieved" | "archived" | "deleted" | "consolidated";

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
}

export function makeMemoryId(): string {
  return `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
