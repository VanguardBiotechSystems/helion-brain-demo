import { describe, expect, it } from "vitest";
import {
  estimateSessionCost,
  decideCostAction,
  PRICE_TABLE,
  COST_MODEL_VERSION,
  type CostControlConfig,
} from "@/lib/server/costControl";
import { applyCostDowngrade, type ResolvedVoiceMode } from "@/lib/server/voiceMode";

const base: CostControlConfig = {
  softDailySessions: 0,
  hardDailySessions: 0,
  maxSessionMs: 0,
  killOpenai: false,
  killElevenlabs: false,
  ownerExempt: true,
};

describe("estimación de coste (bloque 3 §5)", () => {
  it("los precios están centralizados y versionados", () => {
    expect(PRICE_TABLE.version).toBe(COST_MODEL_VERSION);
    expect(PRICE_TABLE.openaiRealtime.audioOutPerMin).toBeGreaterThan(0);
  });

  it("estima el coste de una sesión (no cero con uso real)", () => {
    const cost = estimateSessionCost({ audioInMinutes: 2, audioOutMinutes: 1, ttsChars: 500 });
    expect(cost).toBeGreaterThan(0);
    // Estimación redondeada, no contable.
    expect(cost).toBe(Math.round(cost * 10000) / 10000);
  });
});

describe("decisión de control de coste", () => {
  it("dentro de límites: ok", () => {
    expect(decideCostAction({ sessionsToday: 5, estimatedCostToday: 1 }, { ...base, softDailySessions: 50 }).action).toBe("ok");
  });

  it("límite blando: fuerza demo_estable (informado)", () => {
    const d = decideCostAction({ sessionsToday: 50, estimatedCostToday: 5 }, { ...base, softDailySessions: 50, ownerExempt: false });
    expect(d.action).toBe("force_demo_estable");
    expect(d.downgradeVoice).toBe(true);
    expect(d.blockNew).toBe(false);
  });

  it("límite duro: bloquea sesiones nuevas", () => {
    const d = decideCostAction({ sessionsToday: 100, estimatedCostToday: 10 }, { ...base, hardDailySessions: 100, ownerExempt: false });
    expect(d.action).toBe("block_new_sessions");
    expect(d.blockNew).toBe(true);
  });

  it("el owner exento se salta el límite blando", () => {
    const d = decideCostAction({ sessionsToday: 100, estimatedCostToday: 10 }, { ...base, softDailySessions: 50, ownerExempt: true }, true);
    expect(d.action).toBe("ok");
  });

  it("kill switch de proveedor SIEMPRE fuerza el downgrade/bloqueo", () => {
    const d = decideCostAction({ sessionsToday: 0, estimatedCostToday: 0 }, { ...base, killElevenlabs: true }, true);
    expect(d.action).toBe("force_demo_estable");
    expect(d.downgradeVoice).toBe(true);
  });
});

describe("downgrade de voz por coste", () => {
  const calidad: ResolvedVoiceMode = { mode: "calidad_voz", requested: "calidad_voz", fallback: false };
  it("degrada calidad_voz → demo_estable marcando costDowngraded", () => {
    const out = applyCostDowngrade(calidad, true);
    expect(out.mode).toBe("demo_estable");
    expect(out.costDowngraded).toBe(true);
  });
  it("no toca demo_estable ni cuando no hay downgrade", () => {
    expect(applyCostDowngrade(calidad, false).mode).toBe("calidad_voz");
    const estable: ResolvedVoiceMode = { mode: "demo_estable", requested: "demo_estable", fallback: false };
    expect(applyCostDowngrade(estable, true).mode).toBe("demo_estable");
  });
});
