/**
 * Logging de servidor con redacción defensiva de secretos.
 * Nunca registra la API key ni cabeceras de autorización.
 */

function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/sk_[A-Za-z0-9]{8,}/g, "sk_***")
    .replace(/ek_[A-Za-z0-9_-]{8,}/g, "ek_***")
    .replace(/xi-api-key['":\s=]+[A-Za-z0-9_-]{8,}/gi, "xi-api-key ***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***");
}

export function logInfo(scope: string, message: string): void {
  console.log(`[${scope}] ${redact(message)}`);
}

export function logError(scope: string, message: string, error?: unknown): void {
  const detail = error instanceof Error ? ` :: ${redact(error.message)}` : "";
  console.error(`[${scope}] ${redact(message)}${detail}`);
}
