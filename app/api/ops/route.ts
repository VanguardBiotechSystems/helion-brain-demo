import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/server/apiGuard";
import { can } from "@/lib/server/authz";
import { enforceRateLimit, clientIpFrom, rateLimitBlocks, rateLimiterReadiness } from "@/lib/server/rateLimit";
import { logError } from "@/lib/server/log";
import { telemetrySummary, telemetryRejectedCount, sessionsStartedToday, usageForDay } from "@/lib/server/telemetryStore";
import { observabilityCounts, observabilityEnabled } from "@/lib/server/observability";
import { lastConsolidationReport } from "@/lib/server/memory/consolidation";
import { getMemoryHealth } from "@/lib/server/memory/service";
import { decideCostAction, estimateSessionCost, COST_MODEL_VERSION } from "@/lib/server/costControl";
import { securityStats } from "@/lib/server/memory/sanitizer";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops — panel operativo (bloque 3, §3). Datos AGREGADOS con
 * timestamps y estado de frescura (no promete tiempo real). Respeta roles:
 * - view_debug (owner privilegiado): todo.
 * - view_tech_status (técnico/creador): salud y agregados, sin perfiles.
 * - resto: 403.
 * Nunca expone contenido privado.
 */
export async function GET(request: NextRequest) {
  const guard = requireAccess(request);
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit("ops", `ip:${clientIpFrom(request.headers)}`);
  if (!limited.allowed) {
    return NextResponse.json({ error: { code: "rate_limited", message: "Demasiadas peticiones." } }, { status: 429 });
  }

  const debug = can(guard.profile, guard.identityStatus, "view_debug");
  const tech = can(guard.profile, guard.identityStatus, "view_tech_status");
  if (!debug && !tech) {
    return NextResponse.json({ error: { code: "forbidden", message: "Sin permiso para el panel operativo." } }, { status: 403 });
  }

  const nowIso = new Date(Date.now()).toISOString();
  const dayIso = nowIso.slice(0, 10);

  const cron = lastConsolidationReport();
  const cronStatus = cron
    ? {
        lastRunAt: cron.ranAt,
        durationMs: cron.durationMs,
        scanned: cron.scanned,
        decayed: cron.decayed,
        expired: cron.expired,
        archivedEpisodic: cron.archivedEpisodic,
        merged: cron.merged,
        pendingExpired: cron.pendingExpired,
        profilesArchived: cron.profilesArchived,
        // Alerta si el cron lleva demasiado sin ejecutarse (>36 h).
        stale: Date.now() - Date.parse(cron.ranAt) > 36 * 3_600_000,
      }
    : { lastRunAt: null, stale: true, note: "el cron aún no se ha ejecutado en esta instancia" };

  let memoryHealth: { availability: string; provider: string } = { availability: "unavailable", provider: "—" };
  if (guard.env.memory.enabled) {
    try {
      const health = await getMemoryHealth(guard.env);
      memoryHealth = {
        availability: health.connectionOk ? (health.persistent ? "available" : "degraded") : "unavailable",
        provider: health.providerEffective,
      };
    } catch (error) {
      logError("ops", "no se pudo leer salud de memoria", error);
    }
  }

  const sessionsToday = sessionsStartedToday(dayIso);
  const usage = usageForDay(dayIso);
  const costDecision = decideCostAction({ sessionsToday, estimatedCostToday: 0 }, guard.env.costControl, false);
  // Estimación (no contable): coste medio por sesión × sesiones de hoy.
  const estPerSession = estimateSessionCost({ audioInMinutes: 1.5, audioOutMinutes: 1.5 });

  const base = {
    generatedAt: nowIso,
    freshness: "agregado (no tiempo real)",
    scope: debug ? "full" : "tech",
    rateLimiter: rateLimiterReadiness(),
    observabilityConfigured: observabilityEnabled(),
    memory: memoryHealth,
    cron: cronStatus,
    usage: {
      sessionsToday,
      totalSessionMs: usage.totalSessionMs,
      longSessions: usage.longSessions,
      estimatedCostTodayUsd: Math.round(estPerSession * sessionsToday * 100) / 100,
      costModelVersion: COST_MODEL_VERSION,
      costAction: costDecision.action,
    },
    telemetry: {
      rejected: telemetryRejectedCount(),
      days: telemetrySummary(debug ? 14 : 3),
    },
    errors: observabilityCounts(),
    security: { rejected: securityStats().rejected },
  };

  // Solo el owner con debug ve bloqueos de rate limit detallados.
  const full = debug ? { rateBlocks: rateLimitBlocks() } : {};
  return NextResponse.json({ ...base, ...full });
}
