import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { extractAndStore, getMemoryStore, applyRetention } from "@/lib/server/memory/service";
import type { CuratorInputMessage } from "@/lib/server/memory/curator";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 16;
const MAX_CHARS = 4000;

/**
 * POST /api/memory/extract — el Memory Curator analiza un fragmento de
 * conversación y guarda solo lo que aporta continuidad.
 */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-extract", limit: 30, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();

  const body = (await request.json().catch(() => null)) as { messages?: unknown; force?: unknown } | null;
  if (!guard.env.memory.autoSave && body?.force !== true) {
    return NextResponse.json(
      { error: { code: "config_missing", message: "El guardado automático está desactivado (MEMORY_AUTO_SAVE=false)." } },
      { status: 403 },
    );
  }

  const raw = Array.isArray(body?.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  const messages: CuratorInputMessage[] = [];
  for (const entry of raw) {
    const role = (entry as { role?: unknown })?.role;
    const content = (entry as { content?: unknown })?.content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      messages.push({ role, content: content.slice(0, MAX_CHARS) });
    }
  }
  if (messages.length === 0) {
    return NextResponse.json({ saved: [], skipped: 0, pendingConfirmation: [] });
  }

  try {
    const store = await getMemoryStore(guard.env);
    const result = await extractAndStore(store, guard.env, messages, guard.profile);
    void applyRetention(store, guard.env);
    return NextResponse.json(result);
  } catch (error) {
    logError("memory", "Fallo en la extracción de memoria", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo extraer memoria de la conversación." } },
      { status: 502 },
    );
  }
}
