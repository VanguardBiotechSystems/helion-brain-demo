import { describe, expect, it } from "vitest";
import { buildTelemetryEvent, type SessionTelemetryInput } from "@/lib/client/telemetry";
import { validateTelemetry } from "@/lib/shared/telemetry";

const input: SessionTelemetryInput = {
  appVersion: "0.1.0",
  promptVersion: "1.0.0",
  selfModelVersion: "1.1.0",
  voiceMode: "demo_estable",
  provider: "openai",
  sessionDurationMs: 123456,
  turns: 9,
  latenciesMs: [800, 900, 1000, 1500, 2000],
  fastResponses: 7,
  interruptionsAttempted: 3,
  interruptionsSucceeded: 3,
  noiseBlocked: 5,
  reconnects: 1,
  errorsByCategory: { openai: 1 },
  fallbacks: 0,
  micDeniedOrLost: 0,
  memoryAvailability: "available",
  memorySaved: 2,
  memoryRejected: 1,
  memoryPending: 0,
  identitySwitches: 1,
  endCode: "user_ended",
};

describe("cliente de telemetría (bloque 3 §2)", () => {
  it("construye un evento que pasa la validación del servidor", () => {
    const event = buildTelemetryEvent(input);
    const result = validateTelemetry(event as unknown);
    expect(result.ok).toBe(true);
  });

  it("calcula p50/p95 de las latencias sin exponer las muestras", () => {
    const event = buildTelemetryEvent(input);
    expect(event.latencyP50Ms).toBe(1000);
    expect(event.latencyP95Ms).toBe(2000);
    expect(event).not.toHaveProperty("latenciesMs");
  });

  it("genera un correlationId efímero (no vacío, no persistente)", () => {
    const a = buildTelemetryEvent(input).correlationId;
    const b = buildTelemetryEvent(input).correlationId;
    expect(a).not.toBe("");
    expect(a).not.toBe(b); // distinto cada vez → no rastreable
  });

  it("NO transporta texto ni contenido (solo recuentos y versiones)", () => {
    const event = buildTelemetryEvent(input);
    const json = JSON.stringify(event);
    expect(json).not.toContain("transcript");
    expect(json).not.toContain("prompt\"");
    // Ningún campo libre de texto de conversación.
    expect(Object.keys(event).sort()).not.toContain("content");
  });
});
