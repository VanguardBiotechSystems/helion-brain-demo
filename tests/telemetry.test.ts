import { describe, expect, it, beforeEach } from "vitest";
import { validateTelemetry, TELEMETRY_SCHEMA_VERSION, type TelemetryEvent } from "@/lib/shared/telemetry";
import { ingestTelemetry, telemetrySummary, __resetTelemetry } from "@/lib/server/telemetryStore";

function validEvent(overrides: Partial<TelemetryEvent> = {}): Record<string, unknown> {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    appVersion: "0.1.0",
    promptVersion: "1.0.0",
    selfModelVersion: "1.1.0",
    voiceMode: "demo_estable",
    provider: "openai",
    browser: "chromium",
    device: "desktop",
    correlationId: "corr-abc-123",
    sessionDurationMs: 120000,
    turns: 8,
    latencyP50Ms: 900,
    latencyP95Ms: 1400,
    fastResponses: 6,
    interruptionsAttempted: 2,
    interruptionsSucceeded: 2,
    noiseBlocked: 4,
    reconnects: 0,
    errorsByCategory: { openai: 1 },
    fallbacks: 0,
    micDeniedOrLost: 0,
    memoryAvailability: "available",
    memorySaved: 2,
    memoryRejected: 1,
    memoryPending: 0,
    identitySwitches: 1,
    endCode: "user_ended",
    ...overrides,
  };
}

describe("validación de telemetría (bloque 3 §2)", () => {
  it("acepta un evento válido y lo normaliza", () => {
    const r = validateTelemetry(validEvent());
    expect(r.ok).toBe(true);
    expect(r.event?.turns).toBe(8);
    expect(r.event?.voiceMode).toBe("demo_estable");
  });

  it("rechaza versión de esquema incorrecta", () => {
    expect(validateTelemetry(validEvent({ schemaVersion: 999 } as never)).ok).toBe(false);
  });

  it("rechaza campos desconocidos (no acepta contenido colado)", () => {
    const bad = { ...validEvent(), transcript: "hola qué tal", prompt: "eres helion" };
    const r = validateTelemetry(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("transcript");
  });

  it("normaliza enums inválidos a valores seguros", () => {
    const r = validateTelemetry(validEvent({ voiceMode: "hacker", endCode: "x", device: "watch" } as never));
    expect(r.ok).toBe(true);
    expect(r.event?.voiceMode).toBe("unknown");
    expect(r.event?.endCode).toBe("unknown");
    expect(r.event?.device).toBe("unknown");
  });

  it("acota números fuera de rango", () => {
    const r = validateTelemetry(validEvent({ turns: -5, sessionDurationMs: 999999999999 } as never));
    expect(r.event?.turns).toBe(0);
    expect(r.event?.sessionDurationMs).toBeLessThanOrEqual(86_400_000);
  });

  it("exige correlationId", () => {
    expect(validateTelemetry(validEvent({ correlationId: "" } as never)).ok).toBe(false);
  });
});

describe("almacén de telemetría agregada", () => {
  beforeEach(() => __resetTelemetry());

  it("agrega por día y es idempotente por correlationId", () => {
    const ev = validateTelemetry(validEvent()).event!;
    expect(ingestTelemetry(ev, "2026-07-11")).toBe(true);
    expect(ingestTelemetry(ev, "2026-07-11")).toBe(false); // duplicado
    const summary = telemetrySummary();
    expect(summary[0].sessions).toBe(1);
    expect(summary[0].turns).toBe(8);
  });

  it("suma varias sesiones y calcula medianas de latencia", () => {
    ingestTelemetry(validateTelemetry(validEvent({ correlationId: "a", latencyP50Ms: 800 } as never)).event!, "2026-07-11");
    ingestTelemetry(validateTelemetry(validEvent({ correlationId: "b", latencyP50Ms: 1000 } as never)).event!, "2026-07-11");
    const s = telemetrySummary()[0];
    expect(s.sessions).toBe(2);
    expect(s.latencyP50Ms).not.toBeNull();
  });

  it("el resumen no expone muestras crudas de latencia ni contenido", () => {
    ingestTelemetry(validateTelemetry(validEvent()).event!, "2026-07-11");
    const s = telemetrySummary()[0] as Record<string, unknown>;
    expect(s.latencyP50Samples).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("transcript");
  });

  it("cuenta sesiones con memoria degradada", () => {
    ingestTelemetry(validateTelemetry(validEvent({ correlationId: "x", memoryAvailability: "degraded" } as never)).event!, "2026-07-11");
    expect(telemetrySummary()[0].memoryDegradedSessions).toBe(1);
  });
});
