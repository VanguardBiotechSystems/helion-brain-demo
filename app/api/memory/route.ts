import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { createMemory, filterMemoriesForProfile, getMemoryStore, makeEmbedder } from "@/lib/server/memory/service";
import { detectScopeCues } from "@/lib/server/memory/permissions";
import { ASSERTION_TYPES, type MemoryAssertionType, type MemoryListFilter, type MemorySensitivity, type MemoryType } from "@/lib/server/memory/types";

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
    const items = filterMemoriesForProfile(await store.list(filter), guard.profile);
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
    scope?: unknown;
    assertionType?: unknown;
  } | null;

  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 1000) : "";
  if (!content) {
    return NextResponse.json(
      { error: { code: "unknown", message: "El recuerdo necesita contenido." } },
      { status: 400 },
    );
  }

  const type = MEMORY_TYPES.includes(body?.type as MemoryType) ? (body?.type as MemoryType) : "semantic";
  const assertionType =
    ASSERTION_TYPES.includes(body?.assertionType as MemoryAssertionType) && body?.assertionType !== "unclassified"
      ? (body?.assertionType as MemoryAssertionType)
      : undefined;
  const sensitivity = SENSITIVITIES.includes(body?.sensitivity as MemorySensitivity)
    ? (body?.sensitivity as MemorySensitivity)
    : "normal";

  try {
    const store = await getMemoryStore(guard.env);
    // Scope: pistas explícitas > scope pedido > default; sin permiso de
    // proyecto, lo compartible baja a privado del hablante.
    const cues = detectScopeCues(content);
    const requested = ["private", "project", "project_demo", "public"].includes(body?.scope as string)
      ? (body?.scope as "private" | "project" | "project_demo" | "public")
      : null;
    let scope = cues.scope ?? requested ?? guard.env.memory.defaultScope;
    if ((scope === "project" || scope === "project_demo") && !guard.profile.canCreateProjectMemory) {
      scope = "private";
    }
    const result = await createMemory(
      store,
      {
        scope,
        ownerProfileId: scope === "private" ? guard.profile.id : null,
        createdByProfileId: guard.profile.id,
        type,
        assertionType,
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
