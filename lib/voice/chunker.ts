/**
 * Chunker de texto para TTS en streaming: convierte los deltas de texto de
 * OpenAI en fragmentos naturales y MÍNIMOS para ElevenLabs, optimizando la
 * primera emisión de audio. Lógica pura, testeada en tests/chunker.test.ts.
 *
 * Reglas:
 * - El primer fragmento sale en cuanto hay una unidad verbal mínima
 *   (firstChunkMinChars) con un límite natural; los siguientes esperan a
 *   chunkMinChars.
 * - Se corta preferentemente en puntuación fuerte (. ! ? …), después en
 *   blanda (, ; :), después por longitud en un espacio. Nunca a mitad de
 *   palabra, nunca fragmentos vacíos, nunca gigantes (maxChunkChars).
 * - Si pasan maxChunkWaitMs sin nuevos deltas y hay texto mínimo, se fuerza
 *   el flush hasta el último espacio.
 */

export interface ChunkerConfig {
  firstChunkMinChars: number;
  chunkMinChars: number;
  maxChunkWaitMs: number;
  maxChunkChars: number;
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  firstChunkMinChars: 12,
  chunkMinChars: 35,
  maxChunkWaitMs: 80,
  maxChunkChars: 180,
};

const STRONG_BOUNDARY = /[.!?…]/;
const SOFT_BOUNDARY = /[,;:]/;

export class SentenceChunker {
  private buffer = "";
  private emitted = 0;
  private lastPushAt = 0;

  constructor(private readonly config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG) {}

  get pendingText(): string {
    return this.buffer.trim();
  }

  get emittedCount(): number {
    return this.emitted;
  }

  private minChars(): number {
    return this.emitted === 0 ? this.config.firstChunkMinChars : this.config.chunkMinChars;
  }

  /** Añade un delta y devuelve los fragmentos listos para sintetizar. */
  push(delta: string, now: number): string[] {
    this.buffer += delta;
    this.lastPushAt = now;
    const chunks: string[] = [];
    let chunk: string | null;
    while ((chunk = this.extractBoundaryChunk()) !== null) {
      chunks.push(chunk);
    }
    return chunks;
  }

  /** Un "." entre dígitos (3.5) o dentro de una abreviatura no es frontera. */
  private isRealBoundary(text: string, index: number): boolean {
    const char = text[index];
    if (!STRONG_BOUNDARY.test(char)) return true;
    const prev = text[index - 1] ?? "";
    const next = text[index + 1] ?? "";
    if (/\d/.test(prev) && /\d/.test(next)) return false;
    return next === "" || /[\s"'»)”]/.test(next);
  }

  private extractBoundaryChunk(): string | null {
    const min = this.minChars();
    const text = this.buffer;
    if (text.trim().length < 2) return null;

    // La frontera MÁS TEMPRANA que produce un fragmento válido = menor
    // latencia. Una frase COMPLETA (puntuación fuerte) se emite aunque sea
    // más corta que el mínimo: "Sí." o "Claro." deben sonar al instante.
    // El mínimo solo gobierna los cortes blandos (coma) y por longitud.
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const isStrong = STRONG_BOUNDARY.test(char) && this.isRealBoundary(text, i);
      const isSoft = SOFT_BOUNDARY.test(char);
      if (!isStrong && !isSoft) continue;
      const candidate = text.slice(0, i + 1).trim();
      if ((isStrong && candidate.length >= 2) || candidate.length >= min) {
        return this.commit(i + 1);
      }
    }

    // Sin puntuación: corta por longitud en el último espacio.
    if (text.length >= this.config.maxChunkChars) {
      const slice = text.slice(0, this.config.maxChunkChars);
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace >= min) {
        return this.commit(lastSpace);
      }
    }
    return null;
  }

  private commit(endIndex: number): string | null {
    const chunk = this.buffer.slice(0, endIndex).trim();
    this.buffer = this.buffer.slice(endIndex).replace(/^\s+/, "");
    if (!chunk) return null;
    this.emitted += 1;
    return chunk;
  }

  /**
   * Flush por inactividad: si no llegan deltas en maxChunkWaitMs y hay
   * texto mínimo, emite hasta el último espacio (nunca a mitad de palabra).
   */
  timeoutFlush(now: number): string | null {
    const trimmed = this.buffer.trim();
    if (trimmed.length < this.minChars()) return null;
    if (now - this.lastPushAt < this.config.maxChunkWaitMs) return null;

    const lastSpace = this.buffer.lastIndexOf(" ");
    if (lastSpace < this.minChars()) return null; // podría cortar una palabra a medias
    return this.commit(lastSpace);
  }

  /** Fin de la respuesta: emite el resto, sea cual sea su longitud. */
  finalize(): string | null {
    const chunk = this.buffer.trim();
    this.buffer = "";
    if (!chunk) return null;
    this.emitted += 1;
    return chunk;
  }

  reset(): void {
    this.buffer = "";
    this.emitted = 0;
    this.lastPushAt = 0;
  }
}
