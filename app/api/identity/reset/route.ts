import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, ACCESS_TTL_MS, createAccessToken } from "@/lib/server/access";
import { requireAccess } from "@/lib/server/apiGuard";

export const dynamic = "force-dynamic";

/** Olvida la identidad de la sesión: vuelve a interlocutor desconocido. */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "identity", limit: 30, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  const response = NextResponse.json({ ok: true, identityStatus: "unknown" });
  response.cookies.set(ACCESS_COOKIE, createAccessToken(guard.env.sessionSecret, guard.env.identity.defaultProfile, "unknown"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ACCESS_TTL_MS / 1000),
  });
  return response;
}
