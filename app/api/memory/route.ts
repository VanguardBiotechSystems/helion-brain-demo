import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { createMemory, getMemoryStore, makeEmbedder } from "@/lib/server/memory/service";
import type { MemoryListFilter, MemorySensitivity, MemoryType } from "@/lib/server/memory/types";

export const dynamic = "force-dynamic";

const MEMORY_TYPES: MemoryType[] = ["episodic", "semantic", "preference", "person", "project", "procedural", "safety"];
const SENSITIVITIES: MemorySensitivity[] = ["normal", "private", "sensitive"];

/** GET /api/memory — lista de recuerdos (por defecto, activos). */
export async function GET(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-read", limit: 120, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  try {
    const store = await getMemoryStore(guard.env);
    const params = request.nextUrl.searchParams;
    const filter: MemoryListFilter = {
      status: (params.get("status") as MemoryListFilter["status"]) ?? "active",
      type: MEMORY_TYPES.includes(params.get("type") as MemoryType)
        ? (params.get("type") as MemoryType)
        : undefined,
      query: params.get("q") ?? undefined,
      limit: 200,
    };
    const items = await store.list(filter);
    return NextResponse.json({
      provider: store.provider,
      count: items.length,
      items: items.map((item) => ({ ...item, embedding: undefined })),
    });
  } catch (error) {
    logError("memory", "Fallo listando recuerdos", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo acceder al almacén de memoria." } },
      { status: 502 },
    );
  }
}

/** POST /api/memory — crea un recuerdo (manual o vía herramienta del agente). */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-write", limit: 60, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  const body = (await request.json().catch(() => null)) as {
    content?: unknown;
    title?: unknown;
    type?: unknown;
    sensitivity?: unknown;
    tags?: unknown;
    importance?: unknown;
    source?: unknown;
  } | null;

  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 1000) : "";
  if (!content) {
    return NextResponse.json(
      { error: { code: "unknown", message: "El recuerdo necesita contenido." } },
      { status: 400 },
    );
  }

  const type = MEMORY_TYPES.includes(body?.type as MemoryType) ? (body?.type as MemoryType) : "semantic";
  const sensitivity = SENSITIVITIES.includes(body?.sensitivity as MemorySensitivity)
    ? (body?.sensitivity as MemorySensitivity)
    : "normal";

  try {
    const store = await getMemoryStore(guard.env);
    const result = await createMemory(
      store,
      {
        type,
        title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : content.slice(0, 80),
        content,
        importance: typeof body?.importance === "number" ? Math.min(1, Math.max(0, body.importance)) : 0.8,
        confidence: 0.95,
        source: body?.source === "manual" ? "manual" : "explicit_user_request",
        sensitivity,
        tags: Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === "string").slice(0, 8) : [],
      },
      { embed: makeEmbedder(guard.env), actor: "user", reason: "guardado explícito" },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "unknown", message: result.rejectedReason ?? "Recuerdo rechazado." } },
        { status: 400 },
      );
    }
    return NextResponse.json({
      item: { ...result.item, embedding: undefined },
      deduplicatedInto: result.deduplicatedInto ?? null,
    });
  } catch (error) {
    logError("memory", "Fallo creando recuerdo", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo guardar el recuerdo." } },
      { status: 502 },
    );
  }
}
