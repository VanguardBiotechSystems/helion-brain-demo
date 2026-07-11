import { NextRequest, NextResponse } from "next/server";
import { clientIpFrom, enforceRateLimit } from "@/lib/server/rateLimit";
import { captureError } from "@/lib/server/observability";
import type { ObservabilityCategory } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4096;
const CATEGORIES: ObservabilityCategory[] = [
  "client", "reconnect", "orb", "openai", "elevenlabs", "identity", "tool", "unknown",
];

/**
 * POST /api/client-error — ingesta de errores de cliente (bloque 3, §1).
 * El cuerpo se SANEA en el servidor antes de reenviarlo a observabilidad; el
 * cliente solo aporta código, categoría y contexto acotado, nunca contenido.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFrom(request.headers);
  const limited = enforceRateLimit("client-error", `ip:${ip}`);
  if (!limited.allowed) {
    return NextResponse.json({ ok: false }, { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } });
  }

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ ok: false }, { status: 413 });

  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const code = typeof body?.code === "string" ? body.code.replace(/[^\w.-]/g, "").slice(0, 40) : "client_error";
  const category = CATEGORIES.includes(body?.category as ObservabilityCategory)
    ? (body?.category as ObservabilityCategory)
    : "client";
  // Mensaje libre acotado y SANEADO por captureError (scrub): no se confía.
  const message = typeof body?.message === "string" ? body.message.slice(0, 160) : "error de cliente";
  const browser = typeof body?.browser === "string" ? body.browser.slice(0, 16) : undefined;
  const phase = typeof body?.phase === "string" ? body.phase.slice(0, 24) : undefined;
  const correlationId = typeof body?.correlationId === "string" ? body.correlationId.slice(0, 40) : undefined;

  // captureError sanea el objeto por completo antes de cualquier reenvío.
  captureError(new Error(message), { category, code, browser, phase, correlationId });
  return NextResponse.json({ ok: true });
}
