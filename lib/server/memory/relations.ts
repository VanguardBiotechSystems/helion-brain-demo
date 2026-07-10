import { cosineSimilarity } from "./embeddings";
import { keywordOverlap } from "./scoring";
import type { MemoryItem, MemoryRelationType } from "./types";

/**
 * Revisión de creencias (sección 4): distingue duplicado, ampliación,
 * actualización, contradicción y soporte entre un candidato nuevo y las
 * memorias previas. La decisión de relación es DETERMINISTA y auditable; no
 * inventa resoluciones cuando faltan datos.
 *
 * La similitud se mide con embeddings (coseno) si ambos los tienen, o con
 * solapamiento de palabras como respaldo. La ventana de la auditoría
 * (~0,75–0,92) es el punto de partida para "candidato a relación"; por
 * debajo se consideran temas distintos y por encima, casi duplicado.
 */

// La escala del coseno (embeddings) y la del solapamiento de palabras
// (respaldo sin embeddings) NO son comparables: la ventana ~0,75–0,92 de la
// auditoría aplica al coseno; el solapamiento reparte mucho más bajo. Cada
// método usa su propia banda calibrada.
export const RELATION_SIMILARITY_LOW = 0.75; // coseno: umbral "relacionadas"
export const RELATION_SIMILARITY_HIGH = 0.92; // coseno: prácticamente duplicado
const KEYWORD_LOW = 0.25; // solapamiento: comparten el sujeto clave
// El solapamiento de palabras infla con conectores ("del", "proyecto"): dos
// frases que solo cambian la fecha rondan 0,6. "Duplicado" exige casi el
// mismo texto, por eso el umbral alto va a 0,8 (por debajo es actualización).
const KEYWORD_HIGH = 0.8;

export interface RelationVerdict {
  relation: MemoryRelationType | null;
  similarity: number;
  method: "embedding" | "keyword";
  /** El candidato debería preferirse sobre el previo (actualización/sustitución). */
  supersedesPrevious: boolean;
  reason: string;
}

/** Señales léxicas de negación/cambio que sugieren contradicción o actualización. */
const NEGATION = /\b(no|nunca|ya no|dej[oó]|cambi[oó]|en realidad|ahora|se ha movido|se movi[oó]|corrige|correcci[oó]n|en vez de|mejor)\b/i;
const CANCEL = /\b(cancel|anul|pospon|aplaz|se ha movido|se movi[oó]|ya no)\w*/i;

function similarity(
  a: MemoryItem,
  b: { embedding: number[] | null; text: string },
): { value: number; method: "embedding" | "keyword"; low: number; high: number } {
  if (a.embedding && b.embedding) {
    return { value: cosineSimilarity(a.embedding, b.embedding), method: "embedding", low: RELATION_SIMILARITY_LOW, high: RELATION_SIMILARITY_HIGH };
  }
  return { value: keywordOverlap(b.text, a), method: "keyword", low: KEYWORD_LOW, high: KEYWORD_HIGH };
}

/**
 * Clasifica la relación entre un candidato y una memoria previa. Puro y testeable.
 */
export function classifyRelation(
  previous: MemoryItem,
  candidate: { embedding: number[] | null; text: string; assertionType?: MemoryItem["assertionType"] },
): RelationVerdict {
  const { value: sim, method, low, high } = similarity(previous, candidate);

  if (sim >= high) {
    return { relation: "duplicates", similarity: sim, method, supersedesPrevious: false, reason: "similitud muy alta: duplicado" };
  }
  if (sim < low) {
    return { relation: null, similarity: sim, method, supersedesPrevious: false, reason: "temas distintos" };
  }

  // Zona intermedia (0,75–0,92): hay relación. ¿Qué clase?
  const text = candidate.text.toLowerCase();
  const hasNegation = NEGATION.test(text) || CANCEL.test(text);

  // Hechos/episodios sobre lo mismo con lenguaje de cambio → actualización o
  // contradicción; sin lenguaje de cambio → soporte/ampliación.
  const bothFactual =
    (candidate.assertionType === "fact" || candidate.assertionType === "ephemeral" || previous.assertionType === "fact") &&
    previous.assertionType !== "opinion";

  if (hasNegation) {
    if (CANCEL.test(text) || previous.type === "episodic" || previous.assertionType === "ephemeral" || bothFactual) {
      // Un cambio sobre un hecho/plan con fuente equivalente: el nuevo manda.
      return {
        relation: "updates",
        similarity: sim,
        method,
        supersedesPrevious: true,
        reason: "el candidato corrige/cambia un hecho o plan previo",
      };
    }
    return {
      relation: "contradicts",
      similarity: sim,
      method,
      supersedesPrevious: false,
      reason: "conflicto sin contexto equivalente: se conservan ambas para auditoría",
    };
  }

  // Opiniones muy parecidas pero con matiz (p. ej. "para lo técnico prefiere
  // largo"): es una precisión, no una contradicción.
  if (previous.assertionType === "opinion" || candidate.assertionType === "opinion") {
    return { relation: "supports", similarity: sim, method, supersedesPrevious: false, reason: "matización/soporte de una preferencia" };
  }

  return { relation: "supports", similarity: sim, method, supersedesPrevious: false, reason: "ampliación coherente" };
}

/** Política determinista de reducción de confianza al ser reemplazada/contradicha. */
export function decayedConfidenceOnSupersede(previousConfidence: number): number {
  return Math.max(0.1, Math.round(previousConfidence * 0.5 * 100) / 100);
}
