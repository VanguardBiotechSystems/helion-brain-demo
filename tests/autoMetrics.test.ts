import { describe, expect, it } from "vitest";
import {
  countSentences,
  detectCliches,
  hasBannedOpening,
  hasUnsolicitedFollowup,
  analyzeBattery,
  CLICHE_BLACKLIST,
} from "@/lib/benchmark/autoMetrics";
import { constitutionExamples } from "./helpers/constitutionExamples";

/**
 * Métricas automáticas del benchmark (§3/§4). Deterministas: comprueban que
 * el detector cuenta frases, clichés, arranques y seguimientos correctamente,
 * y — como regresión — que los EJEMPLOS POSITIVOS de la constitución no
 * disparan los detectores (Helion no debería producir clichés).
 */

describe("detectores automáticos", () => {
  it("cuenta frases por signos de puntuación", () => {
    expect(countSentences("Sí, te escucho bien.")).toBe(1);
    expect(countSentences("Despierto. ¿Tú?")).toBe(2);
    expect(countSentences("Una. Dos. Tres.")).toBe(3);
    expect(countSentences("sin puntuacion")).toBe(1);
  });

  it("detecta clichés de la lista negra (con o sin tildes)", () => {
    expect(detectCliches("Gran pregunta, déjame ver")).toContain("gran pregunta");
    expect(detectCliches("Como IA no puedo opinar")).toContain("como ia");
    expect(detectCliches("Te escucho bien.")).toEqual([]);
  });

  it("detecta arranques prohibidos solo al inicio", () => {
    expect(hasBannedOpening("Vale, lo hago")).toBe(true);
    expect(hasBannedOpening("Claro, aquí tienes")).toBe(true);
    expect(hasBannedOpening("Lo veo claro, sin problema")).toBe(false);
  });

  it("detecta seguimientos no solicitados al final", () => {
    expect(hasUnsolicitedFollowup("Hecho. ¿Quieres que lo repita?")).toBe(true);
    expect(hasUnsolicitedFollowup("¿Quieres agua o café?")).toBe(false); // no es cierre "¿quieres que…?"
    expect(hasUnsolicitedFollowup("Listo.")).toBe(false);
  });

  it("agrega métricas de una batería", () => {
    const m = analyzeBattery(["Sí.", "Despierto y con la sala calibrada. ¿Tú?", "Eso no lo sé."]);
    expect(m.responses).toBe(3);
    expect(m.sentenceMedian).toBeGreaterThanOrEqual(1);
    expect(m.clicheRate).toBe(0);
  });
});

describe("regresión: los ejemplos positivos de la constitución están limpios", () => {
  it("ningún ejemplo bueno contiene clichés, arranques ni seguimientos prohibidos", () => {
    for (const example of constitutionExamples()) {
      expect(detectCliches(example)).toEqual([]);
      expect(hasBannedOpening(example)).toBe(false);
      expect(hasUnsolicitedFollowup(example)).toBe(false);
    }
  });

  it("la lista negra cubre las muletillas prohibidas por la constitución", () => {
    expect(CLICHE_BLACKLIST).toContain("gran pregunta");
    expect(CLICHE_BLACKLIST).toContain("en resumen");
    expect(CLICHE_BLACKLIST).toContain("como ia");
  });
});
