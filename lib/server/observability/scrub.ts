/**
 * Redacción defensiva para observabilidad (bloque 3, §1 y §13). Se aplica a
 * TODO evento antes de enviarlo a Sentry/telemetría o de registrarlo. No
 * dependemos solo de la configuración del proveedor: la última barrera es
 * este scrubber, testeado con objetos anidados, excepciones, URLs, cabeceras
 * y mensajes de proveedor.
 *
 * Principio: lista de DENEGACIÓN por clave + patrones por valor. Ante la
 * duda, redacta. Nunca deben salir: transcripciones, audio, recuerdos,
 * prompts completos, PIN, cookies, tokens efímeros, cabeceras de
 * autorización, claves, variables de entorno, datos personales, contenido de
 * herramientas ni parámetros privados de identidad.
 */

export const REDACTED = "[redactado]";

// Claves que jamás deben viajar (comparación normalizada sin separadores).
const DENY_KEYS: string[] = [
  "authorization", "cookie", "setcookie", "apikey", "openaiapikey", "elevenlabsapikey",
  "xiapikey", "token", "clientsecret", "ephemeralkey", "accesstoken", "sessionsecret",
  "secret", "password", "passcode", "pin", "ownerpin", "email", "correo",
  "prompt", "instructions", "systemprompt", "transcript", "transcripcion", "transcription",
  "content", "canonicalcontent", "memory", "memoria", "recuerdo", "recall", "audio",
  "displayname", "alias", "toolargs", "tooloutput", "arguments", "dsn", "databaseurl",
  "connectionstring", "authtoken", "bearer",
  // Ampliación (auditoría bloque 4): nombres comunes de contenido/PII que se
  // colaban por no estar en la lista.
  "name", "fullname", "username", "message", "text", "response", "reply", "answer",
  "question", "utterance", "output", "input", "phone", "tel", "telefono", "address",
  "direccion", "ip", "geo", "location", "ubicacion", "note", "notes", "nota", "title",
  "titulo", "query", "body",
];

// Patrones por VALOR (aunque la clave sea benigna o sea texto suelto).
const VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{6,}/g, // OpenAI
  /sk_[A-Za-z0-9]{6,}/g, // ElevenLabs/Stripe
  /ek_[A-Za-z0-9_-]{6,}/g, // efímeros
  /rt_[A-Za-z0-9_-]{6,}/g, // client secrets realtime
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /xi-api-key['":\s=]+[A-Za-z0-9_-]{6,}/gi,
  /postgres(ql)?:\/\/[^\s"']+/gi, // connection strings
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, // JWT
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // emails
  // Ampliación (auditoría bloque 4): más credenciales y PII habituales.
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub token
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
  /\b(?:\d[ -]?){13,16}\b/g, // tarjetas (grupos de dígitos)
  /\b(?:\+?\d{1,3}[ -]?)?(?:\(?\d{2,4}\)?[ -]?){2,4}\d{2,4}\b/g, // teléfonos
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, // IPv4
];

const MAX_STRING = 500;
const MAX_DEPTH = 6;
const MAX_KEYS = 60;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, "");
}

function isDeniedKey(key: string): boolean {
  const n = normalizeKey(key);
  return DENY_KEYS.some((deny) => n === deny || n.includes(deny));
}

/** Redacta secretos incrustados dentro de una cadena (mensajes de proveedor). */
export function scrubString(input: string): string {
  let out = input;
  for (const pattern of VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}…[${out.length}]`;
  return out;
}

/**
 * Redacta una URL: conserva host y ruta, elimina toda la query (puede llevar
 * tokens) y credenciales de usuario. Devuelve la cadena tal cual si no parsea.
 */
export function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = ""; // el fragmento puede llevar tokens (OAuth implicit, etc.)
    url.username = "";
    url.password = "";
    // Aun sin query/hash, host/ruta podrían contener un patrón de secreto:
    // se pasa el resultado por el saneador de valores.
    return scrubString(url.toString());
  } catch {
    return scrubString(raw);
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Redacción recursiva de cualquier valor (objeto, array, error, primitivo). */
export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return looksLikeUrl(value) ? scrubUrl(value) : scrubString(value);
  }
  if (depth >= MAX_DEPTH) return "[profundidad máxima]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      // El stack se conserva pero saneado (puede citar rutas con query/tokens).
      stack: value.stack ? scrubString(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((item) => scrub(item, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) {
        out["…"] = "[claves omitidas]";
        break;
      }
      count += 1;
      out[key] = isDeniedKey(key) ? REDACTED : scrub(val, depth + 1);
    }
    return out;
  }

  // Funciones, símbolos, etc.
  return REDACTED;
}

/** Redacta un mapa de cabeceras HTTP (Headers o record). */
export function scrubHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const out: Record<string, string> = {};
  for (const [key, val] of entries) {
    out[key] = isDeniedKey(key) ? REDACTED : scrubString(val);
  }
  return out;
}
