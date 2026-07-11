import { describe, expect, it } from "vitest";
import { evaluateAddressing, normalizeWake, DEFAULT_WAKE_CONFIG, type AddressingInput } from "@/lib/wake/addressingGate";

function decide(text: string, over: Partial<AddressingInput> = {}) {
  return evaluateAddressing({ text, inputMode: "voice", attentive: false, agentSpeaking: false, ...over });
}

describe("AddressingGate — activación inteligente (no mención)", () => {
  it("NO responde a saludo genérico sin nombre", () => {
    const d = decide("Hola, ¿cómo estás?");
    expect(d.shouldRespond).toBe(false);
    expect(d.mode).toBe("background");
  });

  it("responde a 'Hola Helion, ¿cómo estás?'", () => {
    const d = decide("Hola Helion, ¿cómo estás?");
    expect(d.shouldRespond).toBe(true);
    expect(d.mode).toBe("direct_address");
    expect(d.cleanedUserText.toLowerCase()).toContain("como estas");
  });

  it("responde a 'Helion, ¿cómo estás?' y limpia el vocativo", () => {
    const d = decide("Helion, ¿cómo estás?");
    expect(d.shouldRespond).toBe(true);
    expect(d.mode).toBe("direct_address");
    expect(normalizeWake(d.cleanedUserText).startsWith("helion")).toBe(false);
  });

  it("NO responde a mención en tercera persona", () => {
    for (const t of [
      "Helion está funcionando bien",
      "Helion es el nombre del sistema",
      "Estábamos hablando de Helion antes",
      "Creo que Helion podría usar memoria",
      "Me gusta cómo suena Helion",
      "El problema de Helion es la latencia",
    ]) {
      const d = decide(t);
      expect(d.shouldRespond, t).toBe(false);
      expect(d.mode, t).toBe("mention_only");
    }
  });

  it("NO responde cuando el vocativo es otra persona ('Sergio, mira Helion')", () => {
    const d = decide("Sergio, mira Helion");
    expect(d.shouldRespond).toBe(false);
    expect(d.mode).toBe("mention_only");
  });

  it("responde a referencia directa aunque el nombre no vaya al inicio", () => {
    const d = decide("Tengo una pregunta para Helion: ¿qué eres?");
    expect(d.shouldRespond).toBe(true);
    expect(d.mode).toBe("direct_address");
  });
});

describe("AddressingGate — llamada aislada y modo atento", () => {
  it("'Helion' a secas → wake_only y abre atención", () => {
    const d = decide("Helion");
    expect(d.shouldRespond).toBe(true);
    expect(d.mode).toBe("wake_only");
    expect(d.opensAttention).toBe(true);
  });

  it("'¿Helion?' también es llamada", () => {
    const d = decide("¿Helion?");
    expect(d.mode).toBe("wake_only");
    expect(d.shouldRespond).toBe(true);
  });

  it("dentro de la ventana atenta responde sin repetir el nombre", () => {
    const d = decide("¿Qué recuerdas de la demo?", { attentive: true });
    expect(d.shouldRespond).toBe(true);
    expect(d.mode).toBe("attentive");
  });

  it("fuera de la ventana atenta NO responde sin nombre", () => {
    const d = decide("¿Qué recuerdas de la demo?", { attentive: false });
    expect(d.shouldRespond).toBe(false);
    expect(d.mode).toBe("background");
  });
});

describe("AddressingGate — comandos e identidad", () => {
  it("'Helion, para' → comando", () => {
    const d = decide("Helion, para");
    expect(d.shouldRespond).toBe(true);
    expect(d.mode).toBe("command");
  });

  it("'para' sin nombre pero mientras Helion habla → corta (seguridad)", () => {
    const d = decide("para", { agentSpeaking: true });
    expect(d.shouldRespond).toBe(true);
    expect(d.mode).toBe("command");
  });

  it("'para' sin nombre y sin hablar → NO corta", () => {
    const d = decide("para");
    expect(d.shouldRespond).toBe(false);
  });

  it("'Helion, soy Sergio' → responde con intención de identidad", () => {
    const d = decide("Helion, soy Sergio");
    expect(d.shouldRespond).toBe(true);
    expect(d.identityIntent).toBe(true);
  });
});

describe("AddressingGate — texto y normalización", () => {
  it("texto escrito sin wake word SÍ responde (intención explícita)", () => {
    const d = decide("¿Qué eres?", { inputMode: "text" });
    expect(d.shouldRespond).toBe(true);
    expect(d.reason).toMatch(/escrita/);
  });

  it("normaliza variantes: 'Elion' y 'Helión' activan", () => {
    expect(decide("Elion, ¿me escuchas?").shouldRespond).toBe(true);
    expect(decide("Helión, preséntate").shouldRespond).toBe(true);
  });

  it("normalizeWake quita tildes y baja a minúsculas", () => {
    expect(normalizeWake("Helión, ¿QUÉ TAL?")).toContain("helion");
  });
});

describe("AddressingGate — config", () => {
  it("modo open responde a todo", () => {
    const d = decide("cualquier cosa", { config: { ...DEFAULT_WAKE_CONFIG, mode: "open" } });
    expect(d.shouldRespond).toBe(true);
  });
  it("respondToMentions=true responde a menciones", () => {
    const d = decide("Helion está muy bien", { config: { ...DEFAULT_WAKE_CONFIG, respondToMentions: true } });
    expect(d.shouldRespond).toBe(true);
  });
});

describe("AddressingGate — contrato de memoria (ignorados no guardan)", () => {
  it("'Sergio, Helion debería recordar esto' es mención → no dirigido (no memoria)", () => {
    const d = decide("Sergio, Helion debería recordar esto");
    expect(d.shouldRespond).toBe(false);
    expect(d.mode).toBe("mention_only");
  });
  it("'Recuerda esto solo para mí' sin nombre ni atento → fondo (no memoria)", () => {
    const d = decide("Recuerda esto solo para mí");
    expect(d.shouldRespond).toBe(false);
    expect(d.mode).toBe("background");
  });
  it("'Helion, recuerda esto' es dirigido → responde (memoria permitida)", () => {
    const d = decide("Helion, recuerda esto");
    expect(d.shouldRespond).toBe(true);
    expect(["direct_address", "command"]).toContain(d.mode);
  });
  it("una mención NO cambia identidad: 'Estamos hablando de Helion, soy fan' → fondo/mención", () => {
    const d = decide("Estamos hablando de Helion");
    expect(d.shouldRespond).toBe(false);
  });
});
