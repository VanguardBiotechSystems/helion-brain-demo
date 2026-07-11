import { describe, expect, it, beforeEach } from "vitest";
import {
  recordConsolidationRun,
  lastConsolidationReport,
  type ConsolidationReport,
} from "@/lib/server/memory/consolidation";
import {
  recordSessionStarted,
  sessionsStartedToday,
  __resetTelemetry,
} from "@/lib/server/telemetryStore";

const report: ConsolidationReport = {
  ran: true, dryRun: false, scanned: 10, expired: 2, archivedEpisodic: 1, decayed: 3, merged: 1,
  pendingExpired: 0, profilesArchived: 0, skippedRecentRun: false, at: "2026-07-11T04:00:00.000Z",
};

describe("estado operativo del cron (bloque 3 §9)", () => {
  it("registra la última ejecución con duración y timestamp", () => {
    recordConsolidationRun(report, 42, "2026-07-11T04:00:00.000Z");
    const last = lastConsolidationReport();
    expect(last?.durationMs).toBe(42);
    expect(last?.scanned).toBe(10);
    expect(last?.ranAt).toBe("2026-07-11T04:00:00.000Z");
  });
});

describe("contador de sesiones del día (control de coste/panel)", () => {
  beforeEach(() => __resetTelemetry());
  it("cuenta sesiones arrancadas por día, independiente de la telemetría de fin", () => {
    expect(sessionsStartedToday("2026-07-11")).toBe(0);
    recordSessionStarted("2026-07-11");
    recordSessionStarted("2026-07-11");
    recordSessionStarted("2026-07-12");
    expect(sessionsStartedToday("2026-07-11")).toBe(2);
    expect(sessionsStartedToday("2026-07-12")).toBe(1);
  });
});
