import type { AppEnv } from "../env";
import { logError } from "../log";

/**
 * Embeddings para búsqueda semántica. Si la llamada falla, la memoria
 * sigue funcionando con búsqueda por palabras clave (embedding = null).
 */

export type EmbedFn = (text: string) => Promise<number[] | null>;

export function makeEmbedder(env: AppEnv): EmbedFn {
  return async (text: string): Promise<number[] | null> => {
    try {
      const response = await fetch(`${env.openaiBaseUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: env.memory.embeddingModel, input: text.slice(0, 4000) }),
        cache: "no-store",
      });
      if (!response.ok) {
        logError("memory", `embeddings fallo status=${response.status}`);
        return null;
      }
      const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
      const embedding = data.data?.[0]?.embedding;
      return Array.isArray(embedding) ? embedding : null;
    } catch (error) {
      logError("memory", "No se pudo generar el embedding", error);
      return null;
    }
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
