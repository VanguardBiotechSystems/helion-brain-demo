/**
 * AddressingGate — capa de "escucha permanente con activación inteligente".
 *
 * Helion mantiene el micrófono abierto pero SOLO responde cuando alguien se
 * DIRIGE a él, no cuando simplemente lo MENCIONAN. Recibe la transcripción de
 * un turno y decide si Helion debe responder. Reglas rápidas y deterministas
 * primero; un clasificador de modelo (opcional, con timeout bajo) solo para
 * los casos ambiguos. Módulo PURO y testeable — sin red ni navegador.
 */

export type WakeConfidence = "high" | "medium" | "low";
export type AddressingMode =
  | "direct_address" // "Helion, ¿cómo estás?"
  | "wake_only" // "Helion" a secas
  | "command" // "Helion, para" / "para" mientras habla
  | "attentive" // dentro de la ventana atenta, sin repetir nombre
  | "mention_only" // "Helion está muy bien" (tercera persona)
  | "background" // no va dirigido y no hay nombre
  | "uncertain"; // ambiguo → puede ir al clasificador de modelo

export type InputMode = "voice" | "text";

export interface WakeConfig {
  /** directed = solo responde si se dirigen a él; open = responde a todo. */
  mode: "directed" | "open";
  /** Nombres/variantes de activación (se normalizan). */
  agentNames: string[];
  requireDirectAddress: boolean;
  attentionWindowMs: number;
  minConfidence: WakeConfidence;
  respondToMentions: boolean;
  /** Reglas primero (rápido); el modelo solo para ambiguos. */
  rulesFirst: boolean;
  /** El primer turno exige el nombre (no basta con "atento" recién abierto). */
  requireNameForFirstTurn: boolean;
}

export const DEFAULT_WAKE_CONFIG: WakeConfig = {
  mode: "directed",
  agentNames: ["Helion", "Elion", "Helión"],
  requireDirectAddress: true,
  attentionWindowMs: 10_000,
  minConfidence: "medium",
  respondToMentions: false,
  rulesFirst: true,
  requireNameForFirstTurn: true,
};

export interface AddressingInput {
  text: string;
  inputMode: InputMode;
  /** ¿Estamos dentro de la ventana atenta (llamó hace poco)? */
  attentive: boolean;
  /** ¿Helion está hablando ahora mismo? (permite "para" de seguridad). */
  agentSpeaking: boolean;
  config?: WakeConfig;
}

export interface AddressingDecision {
  shouldRespond: boolean;
  confidence: WakeConfidence;
  reason: string;
  mode: AddressingMode;
  /** Texto para el cerebro, sin el vocativo de invocación cuando aplica. */
  cleanedUserText: string;
  detectedWakeWord: string | null;
  addressedAgentName: string | null;
  requiresClarification: boolean;
  /** ¿La llamada debería abrir/renovar la ventana atenta? */
  opensAttention: boolean;
  /** Señal de que el turno trae intención de fijar/cambiar identidad. */
  identityIntent: boolean;
}

// ── Normalización ────────────────────────────────────────────────────────
export function normalizeWake(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tildes
    .replace(/[^a-z0-9ñ¿?¡!.,:; ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Variantes de escritura/pronunciación toleradas por nombre. */
function nameVariants(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = normalizeWake(raw).replace(/[^a-z0-9ñ ]/g, "").trim();
    if (!n) continue;
    out.add(n);
    out.add(n.replace(/\s+/g, "")); // "e lion" → "elion"
  }
  // Errores comunes del transcriptor.
  ["helion", "elion", "helio", "helión", "e lion", "elian", "eelion"].forEach((v) =>
    out.add(normalizeWake(v).replace(/\s+/g, " ")),
  );
  return [...out].filter(Boolean);
}

const GREETINGS = ["hola", "oye", "hey", "ey", "eh", "vale", "venga", "buenas", "oiga", "escucha", "perdona", "disculpa"];
// Verbos/cópulas de TERCERA persona: si el nombre va seguido de esto, es mención.
const THIRD_PERSON = [
  "es", "era", "esta", "estaba", "sera", "seria", "suena", "sonaba", "tiene", "tenia",
  "deberia", "podria", "puede", "funciona", "va", "fue", "parece", "queda", "quedo", "quedado",
  "ha", "habia", "esta muy", "molar", "mola", "existe", "usa", "usaria",
];
// Comandos críticos. "para" es ambiguo (comando vs preposición "para X"): se
// trata como comando solo si es terminal o va seguido de "ya".
const HARD_COMMANDS = ["parate", "detente", "callate", "calla", "silencio", "apagate", "apaga", "stop", "basta"];

function findName(words: string[], variants: string[]): { index: number; word: string } | null {
  for (let i = 0; i < words.length; i++) {
    // token exacto o token que sea una variante compacta
    const w = words[i].replace(/[^a-z0-9ñ]/g, "");
    if (variants.includes(w)) return { index: i, word: w };
    // "e lion" → dos tokens
    if (i + 1 < words.length) {
      const pair = (w + words[i + 1].replace(/[^a-z0-9ñ]/g, "")).trim();
      if (variants.includes(pair)) return { index: i, word: pair };
    }
  }
  return null;
}

function hasCommand(words: string[]): string | null {
  const stripped = words.map((w) => w.replace(/[^a-z0-9ñ]/g, ""));
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (HARD_COMMANDS.includes(c)) return c;
    if (c === "para") {
      const next = stripped[i + 1] ?? "";
      const isLast = stripped.slice(i + 1).every((x) => x === "");
      if (isLast || next === "ya") return "para"; // "Helion, para" / "para ya"
    }
  }
  return null;
}

/** Quita el vocativo de invocación del inicio para pasar texto limpio. */
function stripVocative(normalized: string, variants: string[]): string {
  // Signos iniciales primero (¿, ¡) para poder anclar el nombre.
  let t = normalized.replace(/^[\s,:.!?¿¡-]+/, "");
  const namePattern = variants.map((v) => v.replace(/\s+/g, "\\s*")).join("|");
  const re = new RegExp(`^(?:(?:${GREETINGS.join("|")})\\s+)?(?:${namePattern})[\\s,:.!?¿¡-]*`, "i");
  t = t.replace(re, "").trim();
  t = t.replace(/^[\s,:.!?¿¡-]+/, "").trim();
  return t;
}

function meets(confidence: WakeConfidence, min: WakeConfidence): boolean {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[confidence] >= rank[min];
}

/**
 * Evaluación por REGLAS (sin modelo). Devuelve la decisión; el modo
 * "uncertain" indica que un clasificador podría desambiguar.
 */
export function evaluateAddressing(input: AddressingInput): AddressingDecision {
  const config = input.config ?? DEFAULT_WAKE_CONFIG;
  const variants = nameVariants(config.agentNames);
  const normalized = normalizeWake(input.text);
  const words = normalized.split(" ").filter(Boolean);
  const base = {
    cleanedUserText: input.text.trim(),
    detectedWakeWord: null as string | null,
    addressedAgentName: null as string | null,
    requiresClarification: false,
    opensAttention: false,
    identityIntent: /\b(soy|me llamo|estas hablando con|cambia de identidad|cambia a|ahora habla)\b/.test(normalized),
  };

  // Modo "open" (no direccionado): responde a todo lo que tenga contenido.
  if (config.mode === "open") {
    return { ...base, shouldRespond: normalized.length > 0, confidence: "high", reason: "modo open", mode: "direct_address" };
  }

  // TEXTO ESCRITO: enviarlo manualmente ES intención explícita → dirigido.
  if (input.inputMode === "text") {
    return {
      ...base,
      shouldRespond: normalized.length > 0,
      confidence: "high",
      reason: "entrada escrita: intención explícita",
      mode: "direct_address",
    };
  }

  const name = findName(words, variants);
  const command = hasCommand(words);

  // Comando de seguridad mientras Helion habla: cortar aunque no repita nombre.
  if (command && input.agentSpeaking) {
    return {
      ...base,
      shouldRespond: true,
      confidence: name ? "high" : "medium",
      reason: `comando de seguridad "${command}" mientras habla`,
      mode: "command",
      detectedWakeWord: name?.word ?? null,
      cleanedUserText: input.text.trim(),
    };
  }

  // SIN nombre.
  if (!name) {
    if (input.attentive) {
      const mode: AddressingMode = command ? "command" : "attentive";
      return {
        ...base,
        shouldRespond: normalized.length > 0,
        confidence: "medium",
        reason: "dentro de la ventana atenta",
        mode,
        cleanedUserText: input.text.trim(),
        opensAttention: true,
      };
    }
    return { ...base, shouldRespond: false, confidence: "high", reason: "sin nombre y no atento", mode: "background" };
  }

  // CON nombre: ¿dirigido o mención?
  base.detectedWakeWord = name.word;
  base.addressedAgentName = config.agentNames.find((n) => normalizeWake(n).replace(/\s+/g, "") === name.word.replace(/\s+/g, "")) ?? config.agentNames[0];
  const strip = (w: string | undefined) => (w ?? "").replace(/[^a-z0-9ñ]/g, "");
  const strippedContent = stripVocative(normalized, variants);
  const contentless = strippedContent === "" || /^[¿?¡!.,\s]*$/.test(strippedContent);

  const nameTokenRaw = words[name.index] ?? "";
  const commaAfterName = /[,:]$/.test(nameTokenRaw); // "Helion," / "Helion:" = vocativo
  const nextWord = strip(words[name.index + 1]);
  const prevWord = strip(words[name.index - 1]);
  const firstStrip = strip(words[0]);
  const startsWithName = name.index === 0;
  const afterGreetingStart = name.index >= 1 && name.index <= 2 && GREETINGS.includes(firstStrip);

  // Vocativo a OTRA persona: "Sergio, mira Helion" → el vocativo (con coma) es
  // alguien que NO es Helion ni un saludo.
  const firstIsOtherVocative =
    words.length > 1 && /[,:]$/.test(words[0] ?? "") && !GREETINGS.includes(firstStrip) && !variants.includes(firstStrip);

  // "…para <name>", "…que <name> me/te responda", "contigo, <name>". El "que
  // <name>" solo es directo si va seguido de objeto 1ª/2ª persona o imperativo
  // ("que Helion me responda"), NO de un verbo en 3ª ("creo que Helion podría").
  const directPrepositional =
    new RegExp(`\\bpara\\s+${name.word}\\b`).test(normalized) ||
    new RegExp(`\\bque\\s+${name.word}\\s+(me|te|nos|responda|diga|explica|explique|cuenta|contesta|dime)\\b`).test(normalized) ||
    new RegExp(`\\bcontigo,?\\s+${name.word}\\b`).test(normalized);

  // Mención en tercera persona: "<name> es/está/…" (sin coma), verbo 3ª ANTES
  // del nombre ("suena Helion", "ha quedado Helion"), "de/sobre <name>",
  // "hablando de <name>".
  const thirdPersonAfter = !commaAfterName && (THIRD_PERSON.includes(nextWord) || THIRD_PERSON.includes(`${nextWord} ${strip(words[name.index + 2])}`));
  const thirdPersonBefore = THIRD_PERSON.includes(prevWord);
  const prepositionBefore = ["de", "sobre"].includes(prevWord);
  const talkingAbout = /\bhablando de\b|\bhablabamos de\b|\bhablar de\b|\bdile a\b|\bdiselo a\b/.test(normalized);
  const mentionSignal = thirdPersonAfter || thirdPersonBefore || prepositionBefore || talkingAbout;

  // 1) Vocativo dirigido a otra persona → mención.
  if (firstIsOtherVocative && !startsWithName && !afterGreetingStart) {
    return { ...base, shouldRespond: false, confidence: "medium", reason: "vocativo dirigido a otra persona", mode: "mention_only", cleanedUserText: input.text.trim() };
  }

  // 2) Dirigido: nombre al inicio, tras saludo, o preposicional.
  if (startsWithName || afterGreetingStart || directPrepositional) {
    // Empieza por el nombre SIN coma y sigue verbo de 3ª persona → es mención
    // ("Helion está bien"), no llamada.
    if (startsWithName && thirdPersonAfter) {
      return { ...base, shouldRespond: config.respondToMentions, confidence: "high", reason: "mención en tercera persona", mode: "mention_only", cleanedUserText: input.text.trim() };
    }
    if (contentless && !command) {
      return { ...base, shouldRespond: true, confidence: "high", reason: "llamada aislada por el nombre", mode: "wake_only", cleanedUserText: "", opensAttention: true };
    }
    return {
      ...base,
      shouldRespond: true,
      confidence: "high",
      reason: command ? `comando dirigido "${command}"` : "vocativo directo a Helion",
      mode: command ? "command" : "direct_address",
      cleanedUserText: strippedContent || input.text.trim(),
      opensAttention: true,
    };
  }

  // 3) Mención en tercera persona.
  if (mentionSignal) {
    if (config.respondToMentions) {
      return { ...base, shouldRespond: true, confidence: "low", reason: "mención (respondToMentions on)", mode: "mention_only", cleanedUserText: input.text.trim() };
    }
    return { ...base, shouldRespond: false, confidence: "high", reason: "mención en tercera persona", mode: "mention_only", cleanedUserText: input.text.trim() };
  }

  // Nombre presente pero posición ambigua.
  const decided: AddressingDecision = {
    ...base,
    shouldRespond: false,
    confidence: "low",
    reason: "nombre presente en posición ambigua",
    mode: "uncertain",
    cleanedUserText: strippedContent || input.text.trim(),
    requiresClarification: false,
  };
  // Si las reglas no exigen dirección estricta y la confianza mínima es baja,
  // una mención con el nombre al inicio se trata como llamada.
  if (!config.requireDirectAddress && meets("low", config.minConfidence)) {
    decided.shouldRespond = true;
    decided.mode = "direct_address";
  }
  return decided;
}
