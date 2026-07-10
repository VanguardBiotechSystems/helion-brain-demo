import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/server/apiGuard";
import { getMemoryHealth } from "@/lib/server/memory/service";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico honesto de persistencia de memoria (sin secretos):
 * provider efectivo, conexión, recuento, latencia y si es persistente de
 * verdad. Si Postgres falla o el disco es efímero, aquí se ve — Helion
 * no finge recordar.
 */
export async function GET(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-read", limit: 120, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  const health = await getMemoryHealth(guard.env);
  return NextResponse.json({
    ...health,
    profile: { id: guard.profile.id, displayName: guard.profile.displayName, role: guard.profile.role },
  });
}
