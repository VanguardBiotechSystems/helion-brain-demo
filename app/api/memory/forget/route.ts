import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { forgetMemories, getMemoryStore } from "@/lib/server/memory/service";

export const dynamic = "force-dynamic";

/** POST /api/memory/forget — archiva recuerdos que casan con la petición. */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-write", limit: 60, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 300) : "";
  if (!query) {
    return NextResponse.json({ error: { code: "unknown", message: "Falta qué olvidar." } }, { status: 400 });
  }

  try {
    const store = await getMemoryStore(guard.env);
    const result = await forgetMemories(store, guard.env, query, "user", guard.profile);
    return NextResponse.json(result);
  } catch (error) {
    logError("memory", "Fallo olvidando recuerdos", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo procesar el olvido." } },
      { status: 502 },
    );
  }
}
