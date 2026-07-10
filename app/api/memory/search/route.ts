import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { getMemoryStore, searchMemories } from "@/lib/server/memory/service";
import { neutralizeStoredContent } from "@/lib/server/memory/retrieval";

export const dynamic = "force-dynamic";

/** POST /api/memory/search — búsqueda semántica de recuerdos. */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-read", limit: 120, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  const body = (await request.json().catch(() => null)) as { query?: unknown; topK?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 500) : "";
  if (!query) {
    return NextResponse.json({ error: { code: "unknown", message: "Falta la consulta." } }, { status: 400 });
  }
  const topK =
    typeof body?.topK === "number" ? Math.min(20, Math.max(1, Math.floor(body.topK))) : undefined;

  try {
    const store = await getMemoryStore(guard.env);
    const results = await searchMemories(store, guard.env, query, { topK, profile: guard.profile });
    return NextResponse.json({
      results: results.map(({ item, score }) => ({
        id: item.id,
        type: item.type,
        assertionType: item.assertionType,
        title: item.title,
        // El contenido devuelto al modelo (memory_recall) se neutraliza: un
        // recuerdo no puede reinyectar una instrucción vía tool output.
        content: neutralizeStoredContent(item.canonicalContent || item.content),
        scope: item.scope,
        importance: item.importance,
        confidence: item.confidence,
        updatedAt: item.updatedAt,
        score: Number(score.toFixed(3)),
      })),
    });
  } catch (error) {
    logError("memory", "Fallo buscando recuerdos", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo buscar en la memoria." } },
      { status: 502 },
    );
  }
}
