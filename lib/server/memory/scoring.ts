import { cosineSimilarity } from "./embeddings";
import type { MemoryItem, ScoredMemory } from "./types";

/**
 * Ranking de recuerdos: combinación de similitud semántica (o solapamiento
 * de palabras si no hay embeddings), importancia, recencia y uso.
 * Funciones puras: se testean en tests/memory.test.ts.
 */

const RECENCY_HALF_LIFE_DAYS = 30;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9ñ]+/)
      .filter((token) => token.length > 2),
  );
}

/** Solapamiento de palabras clave (0..1) como fallback sin embeddings. */
export function keywordOverlap(query: string, item: MemoryItem): number {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return 0;
  const itemTokens = tokenize(`${item.title} ${item.canonicalContent} ${item.tags.join(" ")}`);
  let hits = 0;
  for (const token of queryTokens) {
    if (itemTokens.has(token)) hits += 1;
  }
  return hits / queryTokens.size;
}

export function recencyFactor(item: MemoryItem, now: number = Date.now()): number {
  const updated = Date.parse(item.updatedAt || item.createdAt);
  if (!Number.isFinite(updated)) return 0.5;
  const ageDays = Math.max(0, (now - updated) / 86_400_000);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

export interface RankOptions {
  queryText?: string;
  queryEmbedding?: number[] | null;
  now?: number;
}

export function scoreMemory(item: MemoryItem, options: RankOptions): number {
  const { queryText, queryEmbedding, now = Date.now() } = options;
  let similarity = 0;
  if (queryEmbedding && item.embedding) {
    similarity = cosineSimilarity(queryEmbedding, item.embedding);
  } else if (queryText) {
    similarity = keywordOverlap(queryText, item);
  }
  const recency = recencyFactor(item, now);
  const usage = Math.min(1, item.accessCount / 20);
  return similarity * 0.55 + item.importance * 0.25 + recency * 0.15 + usage * 0.05;
}

export function rankMemories(items: MemoryItem[], options: RankOptions, topK: number): ScoredMemory[] {
  return items
    .filter((item) => item.status === "active")
    .map((item) => ({ item, score: scoreMemory(item, options) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));
}

/**
 * Construye el bloque de contexto para el modelo con presupuesto de
 * caracteres. Las memorias de seguridad van SIEMPRE primero: son reglas
 * no negociables del robot.
 */
export function buildMemoryContext(items: MemoryItem[], budgetChars = 1200): string {
  const active = items.filter((item) => item.status === "active");
  const safety = active.filter((item) => item.type === "safety");
  const rest = active.filter((item) => item.type !== "safety");

  const lines: string[] = [];
  let used = 0;
  for (const item of [...safety, ...rest]) {
    const line = `- (${item.type}) ${item.canonicalContent || item.content}`;
    if (used + line.length > budgetChars && lines.length > 0) {
      // El presupuesto nunca expulsa a las memorias de seguridad.
      if (item.type === "safety") {
        lines.push(line);
        used += line.length;
      }
      continue;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}
