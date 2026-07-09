import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Control de acceso por passcode con cookie firmada (HMAC-SHA256).
 * Formato del token: "<expiraciónMs>.<nonce>.<firma-base64url>".
 * Funciones puras para poder testearlas sin framework.
 */

export const ACCESS_COOKIE = "hb_access";
export const ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAccessToken(secret: string, now: number = Date.now(), ttlMs: number = ACCESS_TTL_MS): string {
  const payload = `${now + ttlMs}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyAccessToken(secret: string, token: string | undefined, now: number = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, signature] = parts;
  const expected = sign(secret, `${expStr}.${nonce}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expiresAt = Number(expStr);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/** Comparación en tiempo constante (hasheando primero para igualar longitudes). */
export function passcodeMatches(expected: string, provided: string): boolean {
  if (typeof provided !== "string" || provided.length === 0 || provided.length > 512) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}
