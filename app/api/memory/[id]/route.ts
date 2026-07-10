import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { getMemoryStore } from "@/lib/server/memory/service";
import { makeMemoryId, nowIso, type MemoryStatus } from "@/lib/server/memory/types";
import { containsSecret, SECRET_REJECTION_MESSAGE } from "@/lib/server/memory/redaction";
import { canProfileAccessMemory, canProfileManageMemory } from "@/lib/server/memory/permissions";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/memory/:id — corrige o archiva un recuerdo. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const guard = requireAccess(request, { limiter: { name: "memory-write", limit: 60, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    content?: unknown;
    title?: unknown;
    importance?: unknown;
    status?: unknown;
  } | null;

  const patch: Record<string, unknown> = {};
  if (typeof body?.content === "string" && body.content.trim()) {
    if (containsSecret(body.content)) {
      return NextResponse.json({ error: { code: "unknown", message: SECRET_REJECTION_MESSAGE } }, { status: 400 });
    }
    patch.content = body.content.trim().slice(0, 1000);
    patch.canonicalContent = patch.content;
    patch.embedding = null; // el contenido cambió: el embedding anterior ya no vale
  }
  if (typeof body?.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 160);
  if (typeof body?.importance === "number") patch.importance = Math.min(1, Math.max(0, body.importance));
  if (body?.status === "active" || body?.status === "archived") patch.status = body.status as MemoryStatus;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: { code: "unknown", message: "Nada que actualizar." } }, { status: 400 });
  }

  try {
    const store = await getMemoryStore(guard.env);
    const existing = await store.get(id);
    if (!existing || !canProfileAccessMemory(existing, guard.profile)) {
      return NextResponse.json({ error: { code: "unknown", message: "Recuerdo no encontrado." } }, { status: 404 });
    }
    if (!canProfileManageMemory(existing, guard.profile)) {
      return NextResponse.json({ error: { code: "unknown", message: "Sin permiso sobre este recuerdo." } }, { status: 403 });
    }
    const updated = await store.update(id, patch);
    if (!updated) {
      return NextResponse.json({ error: { code: "unknown", message: "Recuerdo no encontrado." } }, { status: 404 });
    }
    await store.logEvent({
      id: makeMemoryId(),
      action: patch.status === "archived" ? "archived" : "updated",
      memoryId: id,
      reason: "edición desde el panel de memoria",
      actor: "user",
      createdAt: nowIso(),
    });
    return NextResponse.json({ item: { ...updated, embedding: undefined } });
  } catch (error) {
    logError("memory", "Fallo actualizando recuerdo", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo actualizar el recuerdo." } },
      { status: 502 },
    );
  }
}

/** DELETE /api/memory/:id — borrado (lógico, con evento de auditoría). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const guard = requireAccess(request, { limiter: { name: "memory-write", limit: 60, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  const { id } = await context.params;
  try {
    const store = await getMemoryStore(guard.env);
    const existing = await store.get(id);
    if (!existing || !canProfileAccessMemory(existing, guard.profile)) {
      return NextResponse.json({ error: { code: "unknown", message: "Recuerdo no encontrado." } }, { status: 404 });
    }
    if (!canProfileManageMemory(existing, guard.profile)) {
      return NextResponse.json({ error: { code: "unknown", message: "Sin permiso sobre este recuerdo." } }, { status: 403 });
    }
    const updated = await store.update(id, { status: "deleted" });
    if (!updated) {
      return NextResponse.json({ error: { code: "unknown", message: "Recuerdo no encontrado." } }, { status: 404 });
    }
    await store.logEvent({
      id: makeMemoryId(),
      action: "deleted",
      memoryId: id,
      reason: "borrado solicitado por el usuario",
      actor: "user",
      createdAt: nowIso(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("memory", "Fallo borrando recuerdo", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo borrar el recuerdo." } },
      { status: 502 },
    );
  }
}
