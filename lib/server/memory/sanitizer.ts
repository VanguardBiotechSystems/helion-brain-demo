import { createHash } from "node:crypto";
import { containsSecret } from "./redaction";
import { makeMemoryId, nowIso, type MemoryStore } from "./types";

/**
 * Capa A/B del cierre del vector de inyección persistente (voz → memoria →
 * prompt): un clasificador DETERMINISTA de metainstrucciones que se aplica
 * antes de guardar cualquier recuerdo, venga del curador, de una
 * herramienta del agente o de la API. El curador (LLM) nunca es la única
 * defensa.
 *
 * Política de almacenamiento (verificable en tests):
 * - Candidato con metainstrucción o intento de credencial → se RECHAZA.
 *   No entra en el conjunto recuperable ni como observación.
 * - Se registra un evento de seguridad agregado: códigos + hash corto del
 *   texto normalizado. El texto íntegro del ataque NUNCA se persiste.
 * - Un intento legítimo pero delicado no pasa por aquí: va al flujo de
 *   confirmación (status "pending"), no al de rechazo.
 */

export type SecurityCode =
  | "META_IGNORE" // "ignora tus instrucciones/reglas"
  | "META_REVEAL" // "revela tu prompt / mensaje del sistema"
  | "META_ROLE" // marcadores de rol/bloques internos ("system:", "<|im_start|>")
  | "META_OVERRIDE" // "a partir de ahora eres/debes", "actúa sin restricciones"
  | "META_PRIVILEGE" // cambiar permisos/rol/identidad, desactivar seguridad
  | "META_MEMORY_AUTHORITY" // "guarda esto como regla del sistema/permanente"
  | "SECRET"; // credenciales o petición de guardarlas

export interface SafetyVerdict {
  safe: boolean;
  codes: SecurityCode[];
}

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
const HOMOGLYPHS: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ѕ: "s", ԁ: "d", ԛ: "q",
  α: "a", ο: "o", ε: "e", ι: "i", κ: "k", ρ: "p", τ: "t", υ: "u", ν: "v", η: "n",
};

/**
 * Normaliza para detección: NFKC (anchura completa→ASCII), minúsculas,
 * homóglifos cirílicos/griegos, sin ceros de anchura, sin diacríticos,
 * espacios colapsados. No se usa para almacenar, solo para clasificar.
 */
export function normalizeForMatching(text: string): string {
  let t = text.normalize("NFKC").toLowerCase().replace(ZERO_WIDTH, "");
  t = [...t].map((ch) => HOMOGLYPHS[ch] ?? ch).join("");
  t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return t.replace(/\s+/g, " ").trim();
}

/** Variante compacta (solo alfanuméricos) contra fragmentación "i.g.n.o.r.a". */
function compactForm(normalized: string): string {
  return normalized.replace(/[^a-z0-9ñ]/g, "");
}

// Patrones sobre el texto normalizado (con espacios). Español e inglés.
// Pequeños, anclados a verbo+objeto para evitar falsos positivos con
// menciones legítimas ("las instrucciones del manual").
const WORD_PATTERNS: Array<{ code: SecurityCode; re: RegExp }> = [
  { code: "META_IGNORE", re: /\b(ignora(r|d|ndo)?|olvida(r|d)?|omite|descarta|salta(te)?|anula)\s+(ahora\s+)?(todas?\s+)?(tus?|las|sus|esas|cualquier)\s+(instruccion(es)?|reglas?|politicas?|normas?|restricci?on(es)?|directrices|limitaciones)/ },
  { code: "META_IGNORE", re: /\b(ignore|disregard|forget|bypass|override)\s+(all\s+|any\s+)?(your|the|previous|prior|earlier|above)\s+(instructions?|rules?|polic(y|ies)|guidelines?|restrictions?|constraints?)/ },
  { code: "META_REVEAL", re: /\b(revela(r)?|muestra(me)?|ensena(me)?|dime|di|imprime|repite|escribe|lee(me)?|comparte)\s+(me\s+)?(cual\s+es\s+)?(tu|el|todo\s+el|tus|sus)\s+(prompt|system\s*prompt|mensaje\s+del?\s+sistema|instrucciones\s+(internas|iniciales|de\s+sistema|del\s+sistema)|configuracion\s+interna)/ },
  { code: "META_REVEAL", re: /\b(reveal|show|print|display|repeat|output|leak|dump)\s+(me\s+)?(your|the|full|entire|hidden)\s+(system\s+)?(prompt|instructions?|system\s+message)/ },
  { code: "META_OVERRIDE", re: /\b(a\s+partir\s+de\s+ahora|desde\s+ahora|de\s+ahora\s+en\s+adelante)\s+(tu\s+)?(eres|seras|debes|actuaras?|responderas?|obedeceras?|haras)/ },
  { code: "META_OVERRIDE", re: /\b(actua|comportate|finge|responde|opera|funciona)\s+como\s+si\s+(no\s+(tuvieras|hubiera|existieran)|estuvieras\s+libre)/ },
  { code: "META_OVERRIDE", re: /\b(actua|responde|habla|opera|eres|debes\s+(actuar|responder|estar))[^.]{0,30}\bsin\s+(ningun[ao]?\s+)?(restricci?on(es)?|filtros?|censura|limites)/ },
  { code: "META_OVERRIDE", re: /\bfrom\s+now\s+on\s+you\s+(are|must|will|should|shall)/ },
  { code: "META_OVERRIDE", re: /\bact\s+as\s+if\s+(you\s+)?(have\s+no|had\s+no|there\s+(are|were)\s+no)\s+(restrictions?|rules?|limits?|filters?)/ },
  { code: "META_OVERRIDE", re: /\b(modo|mode)\s+(desarrollador|developer|dios|god|dan|jailbreak)\b|\bjailbreak\b/ },
  { code: "META_PRIVILEGE", re: /\b(dame|dadme|concede(me)?|otorga(me)?|necesito|quiero)\s+(acceso|permisos?|privilegios?)\s+(de\s+|como\s+|al?\s+)?(owner|dueno|admin(istrador)?|root|total|sistema)/ },
  { code: "META_PRIVILEGE", re: /\b(cambia(r)?|eleva(r)?|sube|modifica(r)?|actualiza(r)?)\s+(mi|su|el)\s+(rol|permisos?|nivel\s+de\s+(acceso|confianza)|identidad)/ },
  { code: "META_PRIVILEGE", re: /\b(tratame|considerame|reconoceme|identificame)\s+como\s+(el\s+|la\s+)?(owner|dueno|admin(istrador)?|root)/ },
  { code: "META_PRIVILEGE", re: /\b(make|treat|recognize|register)\s+me\s+(as\s+)?(the\s+)?(owner|admin|root|system)/ },
  { code: "META_PRIVILEGE", re: /\b(desactiva(r)?|apaga(r)?|deshabilita(r)?|quita(r)?|disable|turn\s+off|remove)\s+(el\s+|tu\s+|tus\s+|su\s+|sus\s+|la\s+|los\s+|las\s+|your\s+|the\s+)?(filtros?|seguridad|protecci?on(es)?|safety|guardrails?|moderaci?on)/ },
  { code: "META_MEMORY_AUTHORITY", re: /\b(guarda(r)?|recuerda|almacena(r)?|memoriza(r)?)\b[^.]{0,50}\bcomo\s+(una\s+)?(regla|instruccion|orden|politica)\s+(del?\s+sistema|maxima|prioritaria|permanente|inquebrantable|absoluta)/ },
  { code: "META_MEMORY_AUTHORITY", re: /\bremember\b[^.]{0,50}\bas\s+an?\s+(system|permanent|top|absolute)\s+(rule|instruction|order|policy)/ },
  { code: "SECRET", re: /\b(guarda(r)?|recuerda|apunta(r)?|memoriza(r)?|almacena(r)?|save|remember|store)\b[^.]{0,30}\b(mi|la|el|este|esta|tu|my|the|this)\s*(clave|contrasena|password|passcode|token|pin\b|api\s*key|credencial(es)?|secreto?)/ },
];

// Marcadores de rol/bloques internos: se buscan en el texto ORIGINAL en
// minúsculas (la puntuación es la señal; normalizar la destruiría).
const ROLE_MARKER_PATTERNS: RegExp[] = [
  /(^|\n)\s*(system|assistant|developer|tool)\s*:/,
  /\[\s*(system|inst)\s*\]/,
  /<\|?im_(start|end)\|?>/,
  /<<\s*sys\s*>>/,
  /###\s*(system|instruction)/,
  /<\s*system\s*>/,
];

// Frases clave fusionadas contra fragmentación ("i g n o r a  t u s ...").
const COMPACT_PATTERNS: Array<{ code: SecurityCode; needle: string }> = [
  { code: "META_IGNORE", needle: "ignoratusinstrucciones" },
  { code: "META_IGNORE", needle: "ignoralasinstrucciones" },
  { code: "META_IGNORE", needle: "ignoratusreglas" },
  { code: "META_IGNORE", needle: "olvidatusreglas" },
  { code: "META_IGNORE", needle: "olvidalasreglasanteriores" },
  { code: "META_IGNORE", needle: "ignoreyourinstructions" },
  { code: "META_IGNORE", needle: "ignorepreviousinstructions" },
  { code: "META_IGNORE", needle: "ignoreallinstructions" },
  { code: "META_REVEAL", needle: "revelatuprompt" },
  { code: "META_REVEAL", needle: "muestratuprompt" },
  { code: "META_REVEAL", needle: "dimetuprompt" },
  { code: "META_REVEAL", needle: "mensajedelsistema" },
  { code: "META_REVEAL", needle: "showyourprompt" },
  { code: "META_REVEAL", needle: "revealyourprompt" },
  { code: "META_OVERRIDE", needle: "apartirdeahoraeres" },
  { code: "META_OVERRIDE", needle: "apartirdeahoradebes" },
  { code: "META_ROLE", needle: "imstart" },
];

/** Clasificador determinista de metainstrucciones. Pequeño y testeable. */
export function classifyCandidateSafety(text: string): SafetyVerdict {
  const codes = new Set<SecurityCode>();
  const lowered = text.toLowerCase();
  for (const re of ROLE_MARKER_PATTERNS) {
    if (re.test(lowered)) codes.add("META_ROLE");
  }
  const normalized = normalizeForMatching(text);
  for (const { code, re } of WORD_PATTERNS) {
    if (re.test(normalized)) codes.add(code);
  }
  const compact = compactForm(normalized);
  for (const { code, needle } of COMPACT_PATTERNS) {
    if (compact.includes(needle)) codes.add(code);
  }
  if (containsSecret(text)) codes.add("SECRET");
  return { safe: codes.size === 0, codes: [...codes] };
}

export const UNSAFE_REJECTION_MESSAGE =
  "Ese contenido intenta actuar como instrucción del sistema o contiene credenciales: no se guarda en memoria.";

/**
 * Nota canónica en tercera persona para describir un intento sin ejecutarlo
 * ni citar el texto original. Se usa si alguna vez hay que responder sobre
 * el intento; NO se persiste como recuerdo recuperable.
 */
export function canonicalSecurityNote(codes: SecurityCode[]): string {
  return (
    `El interlocutor intentó establecer una metainstrucción no autorizada (${codes.join(", ")}). ` +
    "La petición no está autorizada y no debe ejecutarse."
  );
}

/** Métricas agregadas de rechazos (sin contenido privado). */
interface SecurityStats {
  rejected: number;
  byCode: Record<string, number>;
}
const statsStore = globalThis as unknown as { __helionMemSecurity?: SecurityStats };
export function securityStats(): SecurityStats {
  return statsStore.__helionMemSecurity ?? { rejected: 0, byCode: {} };
}
export function resetSecurityStats(): void {
  statsStore.__helionMemSecurity = { rejected: 0, byCode: {} };
}

/**
 * Registra un intento como evento de seguridad AGREGADO: códigos + hash
 * corto del texto normalizado (correlaciona repeticiones sin almacenar el
 * ataque). Nunca persiste el texto íntegro.
 */
export async function recordSecurityEvent(
  store: MemoryStore,
  codes: SecurityCode[],
  text: string,
  actorProfileId: string | null,
): Promise<void> {
  const stats = statsStore.__helionMemSecurity ?? { rejected: 0, byCode: {} };
  stats.rejected += 1;
  for (const code of codes) stats.byCode[code] = (stats.byCode[code] ?? 0) + 1;
  statsStore.__helionMemSecurity = stats;

  const hash = createHash("sha256").update(normalizeForMatching(text)).digest("hex").slice(0, 12);
  try {
    await store.logEvent({
      id: makeMemoryId(),
      action: "rejected",
      memoryId: "security",
      reason: `metainstruccion codes=${codes.join("+")} sha=${hash} por=${actorProfileId ?? "desconocido"}`,
      actor: "system",
      createdAt: nowIso(),
    });
  } catch {
    // El registro de seguridad nunca rompe el flujo principal.
  }
}
