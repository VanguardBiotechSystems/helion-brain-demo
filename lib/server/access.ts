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

export function createAccessToken(
  secret: string,
  profileId: string = "guest",
  identityStatus: string = "unknown",
  now: number = Date.now(),
  ttlMs: number = ACCESS_TTL_MS,
): string {
  const safeProfile = profileId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeStatus = identityStatus.replace(/[^a-z_]/g, "");
  const payload = `${now + ttlMs}.${randomBytes(9).toString("base64url")}.${safeProfile}.${safeStatus}`;
  return `${payload}.${sign(secret, payload)}`;
}

/**
 * Verifica el token y devuelve el profileId firmado, o null si no es
 * válido. El perfil viaja DENTRO de la firma: el cliente no puede
 * autoasignarse identidad.
 */
export interface AccessSession {
  profileId: string;
  identityStatus: string;
  expiresAt: number;
}

export function verifyAccessToken(
  secret: string,
  token: string | undefined,
  now: number = Date.now(),
): AccessSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [expStr, nonce, profileId, identityStatus, signature] = parts;
  const expected = sign(secret, `${expStr}.${nonce}.${profileId}.${identityStatus}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return { profileId: profileId || "guest", identityStatus: identityStatus || "unknown", expiresAt };
}

/** Comparación en tiempo constante (hasheando primero para igualar longitudes). */
export function passcodeMatches(expected: string, provided: string): boolean {
  if (typeof provided !== "string" || provided.length === 0 || provided.length > 512) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}
