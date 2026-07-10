import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, ACCESS_TTL_MS, createAccessToken } from "@/lib/server/access";
import { requireAccess } from "@/lib/server/apiGuard";
import { logInfo } from "@/lib/server/log";
import { matchProfileByAlias, ownerPinMatches, slugifyProfileId, getProfileById } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

/**
 * Cambia el interlocutor a mitad de sesión (alias de resolve): resuelve la identidad conversacional ("Soy Sergio") y re-emite la cookie
 * con el perfil FIRMADO. El cliente nunca envía permisos: el servidor los
 * deriva del registro de perfiles conocidos. Los perfiles sensibles (owner)
 * pueden exigir PIN (OWNER_IDENTITY_PIN).
 */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "identity", limit: 30, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  const { env } = guard;

  const body = (await request.json().catch(() => null)) as { name?: unknown; pin?: unknown } | null;
  const claim = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!claim) {
    return NextResponse.json({ error: { code: "unknown", message: "Falta el nombre." } }, { status: 400 });
  }

  let profile = matchProfileByAlias(env.profiles, claim);
  let status: "claimed" | "confirmed" | "guest" = "claimed";
  if (!profile) {
    if (!env.identity.allowDynamicProfiles) {
      profile = getProfileById(env.profiles, "guest", false)!;
      status = "guest";
    } else {
      // Persona nueva: perfil dinámico de visitante con memoria privada propia.
      profile = getProfileById(env.profiles, slugifyProfileId(claim), true)!;
      status = "claimed";
    }
  }

  // Perfil sensible: confirmación por PIN si está configurado.
  if (profile.requiresPin && env.identity.requireOwnerPin) {
    if (env.identity.ownerPin) {
      if (!pin) {
        return NextResponse.json({ ok: false, requiresPin: true, displayName: profile.displayName });
      }
      if (!ownerPinMatches(env.identity.ownerPin, pin)) {
        return NextResponse.json({ ok: false, requiresPin: true, invalidPin: true });
      }
      status = "confirmed";
    }
    // Sin PIN configurado: modo demo (warning visible en debug).
  }
  if (profile.role !== "owner") status = profile.id === "guest" ? "guest" : "confirmed";
  else if (!env.identity.ownerPin) status = "claimed"; // owner sin PIN: nunca "confirmed"

  logInfo("identity", `Identidad de sesión → ${profile.id} (${status})`);
  const response = NextResponse.json({
    ok: true,
    profile: { id: profile.id, displayName: profile.displayName, role: profile.role, trustLevel: profile.trustLevel },
    identityStatus: status,
  });
  response.cookies.set(ACCESS_COOKIE, createAccessToken(env.sessionSecret, profile.id, status), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ACCESS_TTL_MS / 1000),
  });
  return response;
}
