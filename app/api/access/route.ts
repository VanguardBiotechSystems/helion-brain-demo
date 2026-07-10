import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_TTL_MS,
  createAccessToken,
  verifyAccessToken,
} from "@/lib/server/access";
import { getProfileById, matchProfileByPasscode } from "@/lib/server/profiles";
import { readEnv } from "@/lib/server/env";
import { clientIpFrom, getLimiter } from "@/lib/server/rateLimit";
import { logError, logInfo } from "@/lib/server/log";

export const dynamic = "force-dynamic";

/** GET: estado de autenticación de la cookie actual. */
export async function GET(request: NextRequest) {
  const { env } = readEnv();
  if (!env) {
    return NextResponse.json({ authenticated: false, configured: false });
  }
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const profileId = verifyAccessToken(env.sessionSecret, token);
  const profile = getProfileById(env.profiles, profileId);
  return NextResponse.json({
    authenticated: Boolean(profile),
    configured: true,
    appName: env.appName,
    agentName: env.agentName,
    profile: profile
      ? { id: profile.id, displayName: profile.displayName, role: profile.role, canViewDebug: profile.canViewDebug }
      : null,
  });
}

/** POST: valida el passcode y emite cookie firmada httpOnly. */
export async function POST(request: NextRequest) {
  const { env, missing } = readEnv();
  if (!env) {
    logError("access", `Variables de entorno ausentes: ${missing.join(", ")}`);
    return NextResponse.json(
      { error: { code: "config_missing", message: "El servidor no está configurado todavía." } },
      { status: 503 },
    );
  }

  const ip = clientIpFrom(request.headers);
  const limiter = getLimiter("login", 10, 15 * 60 * 1000);
  const { allowed, retryAfterMs } = limiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiados intentos. Espera unos minutos." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { passcode?: unknown } | null;
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";

  const profile = matchProfileByPasscode(env.profiles, passcode);
  if (!profile) {
    logInfo("access", `Passcode incorrecto desde ip=${ip}`);
    return NextResponse.json(
      { error: { code: "passcode_incorrect", message: "Passcode incorrecto." } },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, createAccessToken(env.sessionSecret, profile.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ACCESS_TTL_MS / 1000),
  });
  logInfo("access", `Acceso concedido a ip=${ip} perfil=${profile.id}`);
  return response;
}

/** DELETE: cierra la sesión de acceso. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
