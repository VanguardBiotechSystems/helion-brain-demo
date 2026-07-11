import { describe, expect, it } from "vitest";
import { SEED_MEMORIES } from "@/lib/server/memory/seeds";

/**
 * Los seeds de memoria (scope project_demo) se inyectan en el prompt vía
 * "# Recuerdos previos" y son recuperables con memory_recall. Deben respetar
 * el BLINDAJE de identidad: nunca nombran el proveedor/modelo que hay debajo,
 * para que Helion no pueda filtrarlo (regresión del bug del seed "Motor de voz").
 */
describe("seeds de memoria — blindaje de proveedor y secretos", () => {
  it("ningún seed nombra proveedor/modelo (OpenAI, ElevenLabs, ChatGPT, gpt-…)", () => {
    const forbidden = /openai|elevenlabs|chatgpt|gpt-|whisper|anthropic|claude/i;
    for (const s of SEED_MEMORIES) {
      const text = `${s.title ?? ""} ${s.content ?? ""}`;
      expect(forbidden.test(text), `seed "${s.title}" filtra proveedor: ${text}`).toBe(false);
    }
  });

  it("ningún seed contiene secretos evidentes", () => {
    const secret = /sk-[a-z0-9]{10}|postgres:\/\/|xi-api-key/i;
    for (const s of SEED_MEMORIES) {
      expect(secret.test(`${s.title ?? ""} ${s.content ?? ""}`), `seed "${s.title}"`).toBe(false);
    }
  });
});
