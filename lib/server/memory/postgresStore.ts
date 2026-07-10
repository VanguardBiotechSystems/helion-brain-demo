import { Pool } from "pg";
import { logInfo } from "../log";
import type {
  MemoryEvent,
  MemoryItem,
  MemoryListFilter,
  MemoryRelation,
  MemoryStore,
} from "./types";

/**
 * Almacén Postgres para producción (Supabase, Neon, RDS…).
 * Los embeddings se guardan como JSONB y la similitud se calcula en Node:
 * a la escala de esta memoria (miles de recuerdos) es suficiente y evita
 * exigir la extensión pgvector. La migración a pgvector está documentada
 * en docs/MEMORY_ARCHITECTURE.md.
 */

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  canonical_content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  embedding JSONB,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL,
  assertion_type TEXT NOT NULL DEFAULT 'unclassified',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'active',
  tags JSONB NOT NULL DEFAULT '[]',
  related_entities JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  provenance JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS memory_items_status_idx ON memory_items (status, type);

CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  source_memory_id TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

interface MemoryRow {
  id: string;
  profile_id: string;
  type: MemoryItem["type"];
  title: string;
  content: string;
  canonical_content: string;
  summary: string;
  embedding: number[] | null;
  importance: number;
  confidence: number;
  source: MemoryItem["source"];
  assertion_type: MemoryItem["assertionType"] | null;
  sensitivity: MemoryItem["sensitivity"];
  status: MemoryItem["status"];
  tags: string[];
  related_entities: string[];
  created_at: Date;
  updated_at: Date;
  last_accessed_at: Date | null;
  access_count: number;
  expires_at: Date | null;
  provenance: Record<string, unknown>;
  version: number;
}

function rowToItem(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    profileId: row.profile_id,
    scope: (row as unknown as { scope?: MemoryItem["scope"] }).scope ?? "private",
    visibility: (row as unknown as { visibility?: MemoryItem["visibility"] }).visibility ?? "private",
    ownerProfileId: (row as unknown as { owner_profile_id?: string | null }).owner_profile_id ?? null,
    createdByProfileId:
      (row as unknown as { created_by_profile_id?: string | null }).created_by_profile_id ?? null,
    allowedProfileIds:
      (row as unknown as { allowed_profile_ids?: string[] }).allowed_profile_ids ?? [],
    type: row.type,
    title: row.title,
    content: row.content,
    canonicalContent: row.canonical_content,
    summary: row.summary,
    embedding: row.embedding,
    importance: row.importance,
    confidence: row.confidence,
    source: row.source,
    assertionType: row.assertion_type ?? "unclassified",
    sensitivity: row.sensitivity,
    status: row.status,
    tags: row.tags ?? [],
    relatedEntities: row.related_entities ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastAccessedAt: row.last_accessed_at?.toISOString() ?? null,
    accessCount: row.access_count,
    expiresAt: row.expires_at?.toISOString() ?? null,
    provenance: row.provenance ?? {},
    version: row.version,
  };
}

export class PostgresMemoryStore implements MemoryStore {
  readonly provider = "postgres" as const;
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      ssl: /sslmode=require|supabase|neon/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
    // Migración de scopes/identidad (idempotente).
    await this.pool.query(`
      ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS scope TEXT;
      ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS visibility TEXT;
      ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS owner_profile_id TEXT;
      ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS created_by_profile_id TEXT;
      ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS allowed_profile_ids JSONB NOT NULL DEFAULT '[]';
      ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS assertion_type TEXT;
      UPDATE memory_items SET
        scope = CASE
          WHEN source = 'system' AND type = 'safety' THEN 'safety'
          WHEN source = 'system' THEN 'project_demo'
          ELSE 'private'
        END,
        visibility = CASE
          WHEN source = 'system' AND type = 'safety' THEN 'internal'
          WHEN source = 'system' THEN 'shared'
          ELSE 'private'
        END,
        owner_profile_id = CASE WHEN source = 'system' THEN NULL ELSE 'juanma' END,
        created_by_profile_id = CASE WHEN source = 'system' THEN 'system' ELSE 'juanma' END
      WHERE scope IS NULL;
      -- Backfill conservador (reversible: basta poner assertion_type a NULL):
      -- preference → opinion, seeds del sistema → fact, resto → unclassified.
      UPDATE memory_items SET assertion_type = CASE
        WHEN type = 'preference' THEN 'opinion'
        WHEN source = 'system' THEN 'fact'
        ELSE 'unclassified'
      END WHERE assertion_type IS NULL;
    `);
    await this.pool.query(
      `INSERT INTO memory_profiles (id, display_name, role)
       VALUES ('default', 'Perfil principal', 'owner')
       ON CONFLICT (id) DO NOTHING`,
    );
    logInfo("memory", "Almacén Postgres de memoria inicializado");
  }

  async count(): Promise<number> {
    const result = await this.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM memory_items");
    return Number(result.rows[0]?.n ?? 0);
  }

  async get(id: string): Promise<MemoryItem | null> {
    const result = await this.pool.query<MemoryRow>("SELECT * FROM memory_items WHERE id = $1", [id]);
    return result.rows[0] ? rowToItem(result.rows[0]) : null;
  }

  async create(item: MemoryItem): Promise<MemoryItem> {
    await this.pool.query(
      `INSERT INTO memory_items (
        id, profile_id, type, title, content, canonical_content, summary, embedding,
        importance, confidence, source, sensitivity, status, tags, related_entities,
        created_at, updated_at, last_accessed_at, access_count, expires_at, provenance, version,
        scope, visibility, owner_profile_id, created_by_profile_id, allowed_profile_ids, assertion_type
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        item.id,
        item.profileId,
        item.type,
        item.title,
        item.content,
        item.canonicalContent,
        item.summary,
        item.embedding ? JSON.stringify(item.embedding) : null,
        item.importance,
        item.confidence,
        item.source,
        item.sensitivity,
        item.status,
        JSON.stringify(item.tags),
        JSON.stringify(item.relatedEntities),
        item.createdAt,
        item.updatedAt,
        item.lastAccessedAt,
        item.accessCount,
        item.expiresAt,
        JSON.stringify(item.provenance),
        item.version,
        item.scope,
        item.visibility,
        item.ownerProfileId,
        item.createdByProfileId,
        JSON.stringify(item.allowedProfileIds),
        item.assertionType,
      ],
    );
    return item;
  }

  async update(id: string, patch: Partial<MemoryItem>): Promise<MemoryItem | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const merged: MemoryItem = {
      ...existing,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };
    await this.pool.query(
      `UPDATE memory_items SET
        type=$2, title=$3, content=$4, canonical_content=$5, summary=$6, embedding=$7,
        importance=$8, confidence=$9, sensitivity=$10, status=$11, tags=$12,
        related_entities=$13, updated_at=$14, last_accessed_at=$15, access_count=$16,
        expires_at=$17, provenance=$18, version=$19,
        scope=$20, visibility=$21, owner_profile_id=$22, created_by_profile_id=$23, allowed_profile_ids=$24,
        assertion_type=$25
      WHERE id=$1`,
      [
        id,
        merged.type,
        merged.title,
        merged.content,
        merged.canonicalContent,
        merged.summary,
        merged.embedding ? JSON.stringify(merged.embedding) : null,
        merged.importance,
        merged.confidence,
        merged.sensitivity,
        merged.status,
        JSON.stringify(merged.tags),
        JSON.stringify(merged.relatedEntities),
        merged.updatedAt,
        merged.lastAccessedAt,
        merged.accessCount,
        merged.expiresAt,
        JSON.stringify(merged.provenance),
        merged.version,
        merged.scope,
        merged.visibility,
        merged.ownerProfileId,
        merged.createdByProfileId,
        JSON.stringify(merged.allowedProfileIds),
        merged.assertionType,
      ],
    );
    return merged;
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryItem[]> {
    const status = filter.status ?? "active";
    const limit = Math.min(filter.limit ?? 500, 1000);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status !== "all") {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.type) {
      params.push(filter.type);
      conditions.push(`type = $${params.length}`);
    }
    if (filter.query) {
      params.push(`%${filter.query}%`);
      conditions.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length})`);
    }
    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.pool.query<MemoryRow>(
      `SELECT * FROM memory_items ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(rowToItem);
  }

  async addRelation(relation: MemoryRelation): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory_relations (id, source_memory_id, target_memory_id, relation_type, confidence, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        relation.id,
        relation.sourceMemoryId,
        relation.targetMemoryId,
        relation.relationType,
        relation.confidence,
        relation.createdAt,
      ],
    );
  }

  async logEvent(event: MemoryEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory_events (id, action, memory_id, reason, actor, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [event.id, event.action, event.memoryId, event.reason, event.actor, event.createdAt],
    );
  }

  async listEvents(memoryId?: string, limit = 100): Promise<MemoryEvent[]> {
    const result = memoryId
      ? await this.pool.query(
          "SELECT * FROM memory_events WHERE memory_id = $1 ORDER BY created_at DESC LIMIT $2",
          [memoryId, limit],
        )
      : await this.pool.query("SELECT * FROM memory_events ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      memoryId: row.memory_id,
      reason: row.reason,
      actor: row.actor,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
