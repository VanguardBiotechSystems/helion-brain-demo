import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { can } from "@/lib/server/authz";
import { logError } from "@/lib/server/log";
import { getMemoryStats, getMemoryStore } from "@/lib/server/memory/service";
import { listProfilesForOwner } from "@/lib/server/memory/profileLifecycle";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory/stats — métricas agregadas para el panel de transparencia
 * (sección 10). Sin texto de recuerdos: solo recuentos, códigos y perfiles.
 * Requiere capacidad view_debug (owner privilegiado) para lo completo; el
 * técnico ve estado técnico pero no metadatos de perfiles.
 */
export async function GET(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-read", limit: 120, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  const debug = can(guard.profile, guard.identityStatus, "view_debug");
  const tech = can(guard.profile, guard.identityStatus, "view_tech_status");
  if (!debug && !tech) {
    return NextResponse.json({ error: { code: "forbidden", message: "Sin permiso para ver métricas." } }, { status: 403 });
  }

  try {
    const store = await getMemoryStore(guard.env);
    const stats = await getMemoryStats(store);
    // Los perfiles dinámicos solo se listan al owner con debug.
    const profiles = debug ? await listProfilesForOwner(store) : [];
    return NextResponse.json({ stats, profiles, scope: debug ? "full" : "tech" });
  } catch (error) {
    logError("memory", "Fallo obteniendo métricas de memoria", error);
    return NextResponse.json({ error: { code: "unknown", message: "No se pudieron obtener las métricas." } }, { status: 502 });
  }
}
