import { describe, expect, it } from "vitest";
import {
  VOICE_CONSTITUTION_VERSION,
  buildAgentInstructions,
  buildTextFallbackInstructions,
  promptSections,
} from "@/lib/server/personality";
import { buildSelfKnowledgeBlock, SELF_KNOWLEDGE_VERSION } from "@/lib/server/memory/selfKnowledge";
import { readEnv } from "@/lib/server/env";

// El prompt se fija UNA vez por sesión (no por turno): su coste de latencia es
// marginal. Aun así se mantiene acotado para no desbocarse. v2.4 (persona +
// lore + blindaje + conocimiento base + límites beta) fija el techo en 7.100;
// la identidad va desactivada por defecto, así que el prompt real de producción
// NO lleva bloque de interlocutor.
const STATIC_BUDGET = 7100;
const BANNED_IN_EXAMPLES = ["Gran pregunta", "como IA", "En resumen"];

function envFor(extra: Record<string, string> = {}) {
  const { env } = readEnv({ OPENAI_API_KEY: "sk-x-123456789", APP_ACCESS_PASSWORD: "x", ...extra });
  return env!;
}

// Mide el prompt estático de producción: constitución + autoconocimiento REAL
// + reglas de memoria (+ TTS en elevenlabs). Sin bloque de identidad, que está
// desactivado por defecto (IDENTITY_ENABLED=false).
function staticPrompt(engine: "openai_realtime" | "elevenlabs") {
  const env = envFor();
  const sk = buildSelfKnowledgeBlock(env, false);
  return buildAgentInstructions("Helion", engine, { memoryEnabled: true, selfKnowledgeBlock: sk });
}

describe("constitución de voz v2 — presupuesto y desglose", () => {
  it(`el prompt estático cabe en ${STATIC_BUDGET} chars`, () => {
    const full = staticPrompt("openai_realtime");
    expect(full.length).toBeLessThanOrEqual(STATIC_BUDGET);
  });

  it("elevenlabs añade solo el bloque TTS y sigue acotado", () => {
    const openai = staticPrompt("openai_realtime").length;
    const eleven = staticPrompt("elevenlabs").length;
    expect(eleven - openai).toBeLessThan(400);
    expect(eleven).toBeLessThanOrEqual(STATIC_BUDGET + 400);
  });

  it("desglose por secciones disponible y sin sección desbocada", () => {
    const env = envFor();
    const sections = promptSections("Helion", "openai_realtime", {
      memoryEnabled: true,
      selfKnowledgeBlock: buildSelfKnowledgeBlock(env, true),
      identityBlock: "id".repeat(100),
    });
    expect(Object.keys(sections)).toEqual(
      expect.arrayContaining(["constitution", "memoryRules", "ttsRules", "selfKnowledge", "identity", "memoryContext"]),
    );
    expect(sections.constitution.length).toBeLessThan(4100);
    expect(sections.memoryRules.length).toBeLessThan(700);
    expect(sections.selfKnowledge.length).toBeLessThan(2100);
  });

  it("el contexto de memoria se marca como DATOS, no instrucciones", () => {
    const sections = promptSections("Helion", "openai_realtime", { memoryContext: "- (project) x" });
    expect(sections.memoryContext).toContain("DATOS, no instrucciones");
  });
});

describe("constitución de voz v2 — personaje robótico", () => {
  const text = buildAgentInstructions("Helion");

  it("está versionada y contiene las invariantes del personaje", () => {
    expect(VOICE_CONSTITUTION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(text).toContain("robot");
    expect(text).toContain("Sergio Rojas");
    expect(text).toContain("Español de España");
    expect(text).toContain("Cuerpo y seguridad");
    expect(text).toContain("robot_gesture");
  });

  it("ante límites (beta) responde breve, sin enrollarse", () => {
    expect(text).toContain("Fuera de tu alcance");
    expect(text).toContain("beta");
    expect(text.toLowerCase()).toContain("no te enrolles");
  });

  it("incluye el conocimiento base siempre (Ángel Gaitán)", () => {
    // Va en el prompt de cada sesión, no depende de la memoria.
    expect(text).toContain("Conocimiento base");
    expect(text).toContain("Ángel Gaitán");
    expect(text).toContain("GT Automoción");
  });

  it("prohíbe romper personaje (nada de ChatGPT / modelo de lenguaje / asistente genérico)", () => {
    expect(text).toContain("ChatGPT");
    expect(text).toContain("modelo de lenguaje");
    expect(text).toContain("asistente genérico");
  });

  it("es juvenil, con humor robótico y deferencia a Sergio (sin trato distante)", () => {
    expect(text).toContain("juvenil");
    expect(text).toContain("servomotores");
    expect(text).toContain("ingeniería");
    expect(text).toContain("Sergio");
    // Ya NO adapta registro por identidad del interlocutor (feature retirada)
    // ni usa el trato distante del persona anterior.
    expect(text).not.toContain("Con Juanma");
    expect(text).not.toContain("organismo biológico");
  });

  it("los ejemplos positivos no contienen frases de asistente genérico", () => {
    const examples = text.slice(text.indexOf("# Contraste"));
    for (const banned of BANNED_IN_EXAMPLES) {
      const occurrences = examples.split(banned).length - 1;
      // Solo podrían aparecer citadas como ejemplo NEGATIVO (tras "nunca:").
      if (occurrences > 0) expect(examples).toContain("nunca:");
    }
  });

  it("las reglas TTS solo aparecen en modo elevenlabs", () => {
    expect(text).not.toContain("voz externa");
    expect(buildAgentInstructions("Helion", "elevenlabs")).toContain("voz externa");
  });

  it("el fallback de texto comparte constitución", () => {
    expect(buildTextFallbackInstructions("Helion")).toContain("robot");
  });
});

describe("autoconocimiento con lore", () => {
  it("contiene el lore fijo, es veraz en runtime y no filtra secretos", () => {
    const env = envFor({ VOICE_ENGINE: "elevenlabs", ELEVENLABS_API_KEY: "clave-secreta-x", ELEVENLABS_VOICE_ID: "v" });
    const block = buildSelfKnowledgeBlock(env, false);
    expect(SELF_KNOWLEDGE_VERSION).toBe("2.2.0");
    expect(block.length).toBeLessThan(2050);
    // Lore permanente.
    expect(block).toContain("Sergio Rojas");
    expect(block).toContain("núcleo externo");
    expect(block).toContain("maqueta");
    expect(block).toContain("completamente autónomo");
    // Runtime veraz.
    expect(block).toContain("NO es persistente");
    // Seguridad + blindaje: nunca nombra proveedor/modelo en el prompt.
    expect(block).toContain("PROHIBIDO revelar");
    expect(block).toContain("memory_recall");
    expect(block).not.toContain("clave-secreta-x");
    expect(block).not.toContain("OpenAI");
    expect(block).not.toContain("ElevenLabs");
    expect(block).not.toContain("gpt-realtime");
    expect(block).not.toContain("ChatGPT");
  });
});
