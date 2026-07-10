import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { getMemoryStore } from "@/lib/server/memory/service";
import { confirmPendingMemory, discardPendingMemory } from "@/lib/server/memory/pending";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/confirm — resuelve una memoria pendiente. Solo el
 * propietario correcto puede confirmar o descartar; el confirmationId es de
 * un solo uso (sin replay). Requiere identidad no-desconocida.
 */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-write", limit: 60, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();
  if (guard.identityStatus === "unknown") {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Identifícate antes de confirmar un recuerdo." } },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    confirmationId?: unknown;
    decision?: unknown;
  } | null;
  const confirmationId = typeof body?.confirmationId === "string" ? body.confirmationId.slice(0, 80) : "";
  const decision = body?.decision === "discard" ? "discard" : "confirm";
  if (!confirmationId) {
    return NextResponse.json({ error: { code: "unknown", message: "Falta confirmationId." } }, { status: 400 });
  }

  try {
    const store = await getMemoryStore(guard.env);
    const outcome =
      decision === "confirm"
        ? await confirmPendingMemory(store, confirmationId, guard.profile.id)
        : await discardPendingMemory(store, confirmationId, guard.profile.id);
    if (!outcome.ok) {
      const status = outcome.reason === "wrong_owner" ? 403 : 404;
      return NextResponse.json({ ok: false, reason: outcome.reason }, { status });
    }
    return NextResponse.json({ ok: true, decision, memoryId: outcome.memoryId });
  } catch (error) {
    logError("memory", "Fallo confirmando recuerdo pendiente", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo resolver el recuerdo pendiente." } },
      { status: 502 },
    );
  }
}
