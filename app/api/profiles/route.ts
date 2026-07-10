import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { can } from "@/lib/server/authz";
import { logError } from "@/lib/server/log";
import { getMemoryStore } from "@/lib/server/memory/service";
import { archiveInactiveProfiles, listProfilesForOwner, restoreProfile } from "@/lib/server/memory/profileLifecycle";

export const dynamic = "force-dynamic";

function requireProfileAdmin(guard: Extract<ReturnType<typeof requireAccess>, { ok: true }>): NextResponse | null {
  if (!can(guard.profile, guard.identityStatus, "admin_profiles")) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Solo el owner confirmado gestiona perfiles." } },
      { status: 403 },
    );
  }
  return null;
}

/** GET /api/profiles — listado de perfiles (owner privilegiado). */
export async function GET(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "profiles", limit: 60, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();
  const forbidden = requireProfileAdmin(guard);
  if (forbidden) return forbidden;

  try {
    const store = await getMemoryStore(guard.env);
    const profiles = await listProfilesForOwner(store);
    return NextResponse.json({ profiles });
  } catch (error) {
    logError("memory", "Fallo listando perfiles", error);
    return NextResponse.json({ error: { code: "unknown", message: "No se pudieron listar los perfiles." } }, { status: 502 });
  }
}

/**
 * POST /api/profiles — operaciones de ciclo de vida (owner privilegiado):
 * { action: "archive"|"restore", id } o { action: "archiveInactive" }.
 */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "profiles", limit: 30, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();
  const forbidden = requireProfileAdmin(guard);
  if (forbidden) return forbidden;

  const body = (await request.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
  const action = body?.action;
  const id = typeof body?.id === "string" ? body.id : "";

  try {
    const store = await getMemoryStore(guard.env);
    if (action === "archiveInactive") {
      const result = await archiveInactiveProfiles(store);
      return NextResponse.json(result);
    }
    if (action === "archive" || action === "restore") {
      if (!id) return NextResponse.json({ error: { code: "unknown", message: "Falta id." } }, { status: 400 });
      // Nunca se puede archivar al propio owner por accidente.
      if (action === "archive" && id === guard.profile.id) {
        return NextResponse.json({ error: { code: "forbidden", message: "No puedes archivar tu propio perfil." } }, { status: 400 });
      }
      if (action === "archive") await store.setProfileStatus(id, "archived");
      else await restoreProfile(store, id);
      return NextResponse.json({ ok: true, id, status: action === "archive" ? "archived" : "active" });
    }
    return NextResponse.json({ error: { code: "unknown", message: "Acción no soportada." } }, { status: 400 });
  } catch (error) {
    logError("memory", "Fallo en operación de perfiles", error);
    return NextResponse.json({ error: { code: "unknown", message: "No se pudo completar la operación." } }, { status: 502 });
  }
}
