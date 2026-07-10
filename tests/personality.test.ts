import { describe, expect, it } from "vitest";
import { buildAgentInstructions, buildTextFallbackInstructions } from "@/lib/server/personality";

describe("personalidad — estilo conversacional humano", () => {
  const instructions = buildAgentInstructions("Helion");

  it("exige respuestas mínimas por defecto (1-3 frases)", () => {
    expect(instructions).toContain("Estilo conversacional (prioridad máxima)");
    expect(instructions).toContain("MÍNIMA cantidad de palabras");
    expect(instructions).toContain("una a tres frases");
  });

  it("prohíbe las muletillas de IA y el tono servil", () => {
    expect(instructions).toContain("gran pregunta");
    expect(instructions).toContain("como inteligencia artificial");
    expect(instructions).toContain("No suenes servil");
    expect(instructions).toContain('No cierres las respuestas con "¿quieres que…?"');
  });

  it("mantiene el castellano de España y la honestidad física", () => {
    expect(instructions).toContain("español de España");
    expect(instructions).toContain("Seguridad física");
  });

  it("la memoria se trata como contexto silencioso", () => {
    const withMemory = buildAgentInstructions("Helion", "openai_realtime", {
      memoryEnabled: true,
      memoryContext: "- (project) Prueba",
    });
    expect(withMemory).toContain("CONTEXTO SILENCIOSO");
    expect(withMemory).toContain("contexto silencioso");
    expect(withMemory).toContain("sin anunciar que los recuerdas");
  });

  it("las reglas TTS solo aparecen en modo elevenlabs", () => {
    expect(instructions).not.toContain("voz externa");
    expect(buildAgentInstructions("Helion", "elevenlabs")).toContain("voz externa");
  });

  it("el modo texto fallback comparte el estilo conciso", () => {
    expect(buildTextFallbackInstructions("Helion")).toContain("Estilo conversacional (prioridad máxima)");
  });

  it("las reglas de voz rápida exigen una sola frase", () => {
    const fast = buildAgentInstructions("Helion", "elevenlabs", {
      fastVoice: true,
      maxNormalSentences: 1,
    });
    expect(fast).toContain("Voz rápida (prioridad máxima)");
    expect(fast).toContain("UNA sola frase");
    expect(fast).toContain("tres a seis palabras");
  });

  it("sin modo rápido no se inyectan las reglas de voz rápida", () => {
    expect(buildAgentInstructions("Helion", "elevenlabs")).not.toContain("Voz rápida");
  });
});
