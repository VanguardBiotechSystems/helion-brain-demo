import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "./access";
import { readEnv, type AppEnv } from "./env";
import { clientIpFrom, getLimiter } from "./rateLimit";

/**
 * Guard común para endpoints autenticados: entorno válido, cookie firmada
 * y rate limiting por sesión (fallback IP). Devuelve el AppEnv o la
 * NextResponse de error lista para retornar.
 */

export interface GuardOptions {
  limiter?: { name: string; limit: number; windowMs: number };
}

export type GuardResult = { ok: true; env: AppEnv; token: string } | { ok: false; response: NextResponse };

export function requireAccess(request: NextRequest, options: GuardOptions = {}): GuardResult {
  const { env, missing } = readEnv();
  if (!env) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "config_missing",
            message: `El servidor no está configurado todavía (faltan: ${missing.join(", ")}).`,
          },
        },
        { status: 503 },
      ),
    };
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  if (!verifyAccessToken(env.sessionSecret, token)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "not_authenticated", message: "La sesión de acceso ha caducado." } },
        { status: 401 },
      ),
    };
  }

  if (options.limiter) {
    const key = token ? `tk:${token.slice(-24)}` : `ip:${clientIpFrom(request.headers)}`;
    const { name, limit, windowMs } = options.limiter;
    const { allowed, retryAfterMs } = getLimiter(name, limit, windowMs).check(key);
    if (!allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: "rate_limited", message: "Demasiadas peticiones en poco tiempo." } },
          { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
        ),
      };
    }
  }

  return { ok: true, env, token };
}

/** Respuesta estándar cuando la memoria está desactivada por configuración. */
export function memoryDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: "config_missing", message: "La memoria está desactivada (MEMORY_ENABLED=false)." } },
    { status: 503 },
  );
}
