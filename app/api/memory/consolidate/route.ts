import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { consolidateMemories, getMemoryStore } from "@/lib/server/memory/service";

export const dynamic = "force-dynamic";

/** POST /api/memory/consolidate — fusiona recuerdos casi duplicados. */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-extract", limit: 10, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  try {
    const store = await getMemoryStore(guard.env);
    const result = await consolidateMemories(store);
    return NextResponse.json(result);
  } catch (error) {
    logError("memory", "Fallo consolidando la memoria", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo consolidar la memoria." } },
      { status: 502 },
    );
  }
}
