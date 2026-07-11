import { NextRequest, NextResponse } from "next/server";
import { memoryDisabledResponse, requireAccess } from "@/lib/server/apiGuard";
import { readEnv } from "@/lib/server/env";
import { timingSafeEqual, createHash } from "node:crypto";
import { logError, logInfo } from "@/lib/server/log";
import { captureError } from "@/lib/server/observability";
import { getMemoryStore } from "@/lib/server/memory/service";
import { runConsolidation, recordConsolidationRun } from "@/lib/server/memory/consolidation";

export const dynamic = "force-dynamic";

/** Ventana de idempotencia por defecto: no reconsolidar si corrió hace < 1 h. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

function bearerMatches(expected: string, header: string | null): boolean {
  if (!expected || !header) return false;
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  if (!provided) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b);
}

/**
 * Cron de consolidación (Vercel Cron u otro). Protegido por
 * MEMORY_CONSOLIDATION_SECRET (Bearer). Idempotente: no repite dentro de la
 * ventana. `?dryRun=1` cuenta sin escribir.
 */
export async function GET(request: NextRequest) {
  const { env } = readEnv();
  if (!env) {
    return NextResponse.json({ error: { code: "config_missing", message: "Servidor no configurado." } }, { status: 503 });
  }
  if (!env.memory.enabled) return memoryDisabledResponse();

  const auth = request.headers.get("authorization");
  if (!env.memory.consolidationSecret || !bearerMatches(env.memory.consolidationSecret, auth)) {
    // 404 en vez de 401: no revelar la existencia del endpoint a sondas.
    return NextResponse.json({ error: { code: "not_found", message: "No encontrado." } }, { status: 404 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  try {
    const store = await getMemoryStore(env);
    const startedAt = Date.now();
    const report = await runConsolidation(store, { dryRun, minIntervalMs: MIN_INTERVAL_MS });
    const durationMs = Date.now() - startedAt;
    if (!dryRun) recordConsolidationRun(report, durationMs, new Date(startedAt).toISOString());
    logInfo("memory", `consolidación cron: ${JSON.stringify(report)}`);
    return NextResponse.json({ ...report, durationMs });
  } catch (error) {
    logError("memory", "Fallo en la consolidación programada", error);
    captureError(error, { category: "cron", code: "consolidation_failed" });
    return NextResponse.json({ error: { code: "unknown", message: "No se pudo consolidar." } }, { status: 502 });
  }
}

/**
 * POST /api/memory/consolidate — disparo manual. Solo owner con capacidad de
 * gestión de memoria; admite dryRun para previsualizar.
 */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "consolidate", limit: 10, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  if (!guard.env.memory.enabled) return memoryDisabledResponse();
  if (!guard.profile.canManageMemory || guard.identityStatus !== "confirmed") {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Solo el owner confirmado puede consolidar la memoria." } },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as { dryRun?: unknown } | null;
  const dryRun = body?.dryRun === true;
  try {
    const store = await getMemoryStore(guard.env);
    // El disparo manual del owner ignora la ventana de idempotencia.
    const report = await runConsolidation(store, { dryRun, minIntervalMs: 0 });
    return NextResponse.json(report);
  } catch (error) {
    logError("memory", "Fallo consolidando la memoria", error);
    return NextResponse.json(
      { error: { code: "unknown", message: "No se pudo consolidar la memoria." } },
      { status: 502 },
    );
  }
}
