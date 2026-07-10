/**
 * Regla dura de privacidad: la memoria JAMÁS almacena credenciales.
 * Este filtro determinista se aplica antes de guardar cualquier recuerdo,
 * venga del curador, de una herramienta del agente o de la API.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/, // claves OpenAI
  /sk_[A-Za-z0-9]{8,}/, // claves estilo ElevenLabs/Stripe
  /ek_[A-Za-z0-9_-]{8,}/, // tokens efímeros
  /xi-api-key/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /\b[0-9a-f]{32,}\b/i, // hex largo (hashes/tokens)
  // base64 largo SIN "/" para no bloquear URLs legítimas con rutas largas
  /\b[A-Za-z0-9+]{40,}={0,2}\b/,
  // "password/contraseña/passcode/token/secret/api key" seguido de un valor
  /(password|passcode|contraseña|api[ _-]?key|token|secret)\s*(es|is|:|=)?\s*["']?[\w.\-]{6,}/i,
  /clave\s+(de\s+)?(api|acceso|openai|elevenlabs)\s*(es|:|=)?\s*["']?\S{6,}/i,
];

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/** Mensaje estándar cuando se rechaza un guardado por contener secretos. */
export const SECRET_REJECTION_MESSAGE =
  "Por seguridad no se guardan claves, contraseñas ni credenciales en la memoria.";
