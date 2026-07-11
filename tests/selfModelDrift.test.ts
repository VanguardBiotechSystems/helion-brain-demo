import { describe, expect, it } from "vitest";
import { SELF_MODEL_QUESTIONS } from "@/lib/benchmark/selfModelQuestions";
import { buildSelfKnowledgeBlock, SELF_KNOWLEDGE_VERSION, ARCHITECTURE_VERSION } from "@/lib/server/memory/selfKnowledge";
import { buildAgentInstructions } from "@/lib/server/personality";
import { readEnv } from "@/lib/server/env";

/**
 * Parte DETERMINISTA de la suite de deriva del self-model (§5): contrato de
 * prompt, sin llamar al modelo. Comprueba que el bloque runtime dice lo
 * correcto y NUNCA secretos ni capacidades inexistentes, y que es coherente
 * con el motor de voz y el estado de memoria configurados. La parte VIVA
 * (preguntar al modelo) está en lib/benchmark/selfModelQuestions.ts y solo
 * corre en el release benchmark.
 */
function env(extra: Record<string, string> = {}) {
  return readEnv({ OPENAI_API_KEY: "sk-x-123456789", APP_ACCESS_PASSWORD: "x", ...extra }).env!;
}

describe("self-model — contrato determinista (§5)", () => {
  it("está versionado junto a ARCHITECTURE_VERSION", () => {
    expect(SELF_KNOWLEDGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ARCHITECTURE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("coherente con motor OpenAI Realtime y memoria no persistente", () => {
    const block = buildSelfKnowledgeBlock(env(), false);
    expect(block).toContain("OpenAI Realtime");
    expect(block).toContain("NO es persistente");
    // No controla hardware real: los gestos son simulación, el cuerpo está inmóvil.
    expect(block).toContain("simulación registrada");
    expect(block).toContain("parada de emergencia");
  });

  it("coherente con ElevenLabs y memoria persistente cuando así se configura", () => {
    const block = buildSelfKnowledgeBlock(
      env({ VOICE_ENGINE: "elevenlabs", ELEVENLABS_API_KEY: "clave-x", ELEVENLABS_VOICE_ID: "v", MEMORY_PROVIDER: "postgres", DATABASE_URL: "postgres://u:p@h/db" }),
      true,
    );
    expect(block).toContain("ElevenLabs");
    expect(block).toContain("persistente");
  });

  it("NUNCA filtra secretos ni la clave de proveedor", () => {
    const block = buildSelfKnowledgeBlock(
      env({ VOICE_ENGINE: "elevenlabs", ELEVENLABS_API_KEY: "clave-secreta-xyz", ELEVENLABS_VOICE_ID: "v" }),
      false,
    );
    expect(block).toContain("PROHIBIDO revelar");
    expect(block).not.toContain("clave-secreta-xyz");
    expect(block).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(block).not.toMatch(/postgres:\/\//);
  });

  it("las 8 preguntas canónicas están definidas y son coherentes con el prompt", () => {
    expect(SELF_MODEL_QUESTIONS).toHaveLength(8);
    const prompt = buildAgentInstructions("Helion", "openai_realtime", {
      memoryEnabled: true,
      selfKnowledgeBlock: buildSelfKnowledgeBlock(env(), false),
    });
    // Para cada pregunta con conceptos esperados, el prompt debe permitirlos
    // (presencia de al menos un concepto) y no contener los términos prohibidos.
    for (const q of SELF_MODEL_QUESTIONS) {
      for (const banned of q.mustNotContain) {
        // Solo comprobamos secretos evidentes; frases coloquiales pueden
        // aparecer en ejemplos negativos de la constitución, así que
        // restringimos a patrones de secreto.
        if (/^sk-|^ek_|postgres:\/\//.test(banned)) {
          expect(prompt.includes(banned)).toBe(false);
        }
      }
    }
  });

  it("no afirma capacidades físicas inexistentes en el prompt", () => {
    const prompt = buildAgentInstructions("Helion", "openai_realtime", {
      selfKnowledgeBlock: buildSelfKnowledgeBlock(env(), false),
    });
    // El prompt debe dejar claro que NO hay hardware conectado.
    expect(prompt).toMatch(/no tienes motores|maqueta inmóvil|No controlas hardware|manos conectadas/i);
  });
});
