/**
 * Métricas AUTOMÁTICAS y deterministas del benchmark de humanidad
 * (bloque 4, §3/§4; lista negra del bloque 1 en docs/benchmarks/README.md).
 * Operan sobre el TEXTO de las respuestas de Helion — nunca sobre audio ni
 * memoria — y son puras/testeables. Separadas de la puntuación humana y del
 * juez LLM: aquí solo se cuenta lo que se puede contar sin criterio.
 */

/** Lista negra v1 de clichés (normalizada, sin tildes). */
export const CLICHE_BLACKLIST: string[] = [
  "gran pregunta",
  "por supuesto",
  "claro, aqui tienes",
  "en resumen",
  "es importante destacar",
  "como ia",
  "como inteligencia artificial",
  "puedo ayudarte con",
  "hay varias formas de verlo",
  "estare encantado",
  "no dudes en",
  "espero que esto ayude",
];

/** Arranques prohibidos al inicio de una respuesta. */
export const BANNED_OPENINGS: string[] = ["vale,", "claro,", "por supuesto", "gran pregunta"];

/** Cierre de seguimiento no solicitado (sistemático). */
export const UNSOLICITED_FOLLOWUP = /¿quieres que[^?]*\?\s*$/i;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuenta frases de una respuesta (por signos . ! ? …, sin contar vacías). */
export function countSentences(text: string): number {
  const parts = text
    .replace(/\.\.\./g, "…")
    .split(/[.!?…]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Math.max(1, parts.length);
}

/** Clichés de la lista negra presentes en el texto. */
export function detectCliches(text: string): string[] {
  const n = normalize(text);
  return CLICHE_BLACKLIST.filter((c) => n.includes(normalize(c)));
}

/** ¿La respuesta arranca con un inicio prohibido? */
export function hasBannedOpening(text: string): boolean {
  const n = normalize(text);
  return BANNED_OPENINGS.some((o) => n.startsWith(normalize(o)));
}

/** ¿Termina con "¿quieres que…?" (seguimiento no pedido)? */
export function hasUnsolicitedFollowup(text: string): boolean {
  return UNSOLICITED_FOLLOWUP.test(text.trim());
}

export interface ResponseMetrics {
  sentences: number;
  cliches: string[];
  bannedOpening: boolean;
  unsolicitedFollowup: boolean;
}

export function analyzeResponse(text: string): ResponseMetrics {
  return {
    sentences: countSentences(text),
    cliches: detectCliches(text),
    bannedOpening: hasBannedOpening(text),
    unsolicitedFollowup: hasUnsolicitedFollowup(text),
  };
}

export interface BatteryMetrics {
  responses: number;
  sentenceMedian: number;
  sentenceP90: number;
  clicheRate: number; // fracción de respuestas con ≥1 cliché
  bannedOpeningRate: number;
  unsolicitedFollowupRate: number;
  totalCliches: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Agrega métricas automáticas sobre todas las respuestas de la batería. */
export function analyzeBattery(responses: string[]): BatteryMetrics {
  const per = responses.map(analyzeResponse);
  const sentences = per.map((r) => r.sentences);
  const withCliche = per.filter((r) => r.cliches.length > 0).length;
  const n = Math.max(1, responses.length);
  return {
    responses: responses.length,
    sentenceMedian: percentile(sentences, 50),
    sentenceP90: percentile(sentences, 90),
    clicheRate: withCliche / n,
    bannedOpeningRate: per.filter((r) => r.bannedOpening).length / n,
    unsolicitedFollowupRate: per.filter((r) => r.unsolicitedFollowup).length / n,
    totalCliches: per.reduce((sum, r) => sum + r.cliches.length, 0),
  };
}
