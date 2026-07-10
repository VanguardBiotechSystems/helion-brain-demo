import { describe, expect, it } from "vitest";
import { DEFAULT_CHUNKER_CONFIG, SentenceChunker } from "@/lib/voice/chunker";

const CFG = DEFAULT_CHUNKER_CONFIG;

describe("SentenceChunker — primer audio rápido", () => {
  it("una frase completa corta se emite al instante aunque no llegue al mínimo", () => {
    const chunker = new SentenceChunker(CFG);
    expect(chunker.push("Sí. ", 0)).toEqual(["Sí."]);
    expect(new SentenceChunker(CFG).push("Estoy aquí. ", 0)).toEqual(["Estoy aquí."]);
  });

  it("una confirmación de dos frases sale como dos fragmentos inmediatos", () => {
    const chunker = new SentenceChunker(CFG);
    expect(chunker.push("Hecho. Lo recordaré.", 0)).toEqual(["Hecho.", "Lo recordaré."]);
  });

  it("sin puntuación no emite por debajo del mínimo (finalize lo entrega)", () => {
    const chunker = new SentenceChunker(CFG);
    expect(chunker.push("Sí", 0)).toEqual([]);
    expect(chunker.finalize()).toBe("Sí");
  });

  it("la coma respeta el mínimo del primer chunk", () => {
    const chunker = new SentenceChunker(CFG);
    // "Sí," (3 chars) no basta; la frontera válida es el punto final.
    expect(chunker.push("Sí, te escucho bien.", 0)).toEqual(["Sí, te escucho bien."]);
  });

  it("los chunks siguientes esperan al mínimo normal", () => {
    const chunker = new SentenceChunker(CFG);
    chunker.push("Estoy aquí, listo.", 0); // primer chunk emitido
    const next = chunker.push(" Dime qué necesitas,", 10);
    expect(next).toEqual([]); // 20 chars < 35
    const more = chunker.push(" y lo preparamos ahora mismo sin esperar.", 20);
    expect(more.length).toBeGreaterThan(0);
  });
});

describe("SentenceChunker — cortes naturales", () => {
  it("nunca corta a mitad de palabra por longitud", () => {
    const chunker = new SentenceChunker({ ...CFG, maxChunkChars: 40 });
    const text = "palabralarga ".repeat(6); // sin puntuación
    const chunks = chunker.push(text, 0);
    for (const chunk of chunks) {
      expect(chunk.endsWith("palabralarga")).toBe(true);
    }
  });

  it("no trata los decimales como final de frase", () => {
    const chunker = new SentenceChunker(CFG);
    const chunks = chunker.push("La versión 2.1 ya está lista", 0);
    // El corte válido es la frontera tras "lista", no el punto de "2.1".
    expect(chunks).toEqual([]);
    expect(chunker.finalize()).toBe("La versión 2.1 ya está lista");
  });

  it("prefiere puntuación aunque haya longitud de sobra", () => {
    const chunker = new SentenceChunker(CFG);
    const chunks = chunker.push("Perfecto, empezamos ya. Después revisamos el resto con calma.", 0);
    expect(chunks[0]).toBe("Perfecto, empezamos ya.");
  });
});

describe("SentenceChunker — flush por inactividad", () => {
  it("fuerza el flush pasado maxChunkWaitMs con texto mínimo", () => {
    const chunker = new SentenceChunker(CFG);
    chunker.push("Voy a explicarte cómo funciona esto sin", 0); // sin puntuación
    expect(chunker.timeoutFlush(40)).toBeNull(); // aún no ha pasado el tiempo
    const flushed = chunker.timeoutFlush(120);
    expect(flushed).toBe("Voy a explicarte cómo funciona esto");
    expect(chunker.pendingText).toBe("sin");
  });

  it("no hace flush si cortaría una palabra", () => {
    const chunker = new SentenceChunker(CFG);
    chunker.push("Palabraunicasinespacios", 0);
    expect(chunker.timeoutFlush(500)).toBeNull();
  });

  it("no emite fragmentos vacíos", () => {
    const chunker = new SentenceChunker(CFG);
    expect(chunker.push("   ", 0)).toEqual([]);
    expect(chunker.finalize()).toBeNull();
  });
});

describe("SentenceChunker — ciclo completo", () => {
  it("respuesta larga: primer chunk corto y resto en frases", () => {
    const chunker = new SentenceChunker(CFG);
    const all: string[] = [];
    const deltas = [
      "Claro. ",
      "El sistema escucha con un gate local, ",
      "razona con el modelo en tiempo real ",
      "y sintetiza la voz en streaming.",
    ];
    let t = 0;
    for (const delta of deltas) {
      all.push(...chunker.push(delta, (t += 10)));
    }
    const rest = chunker.finalize();
    if (rest) all.push(rest);
    expect(all[0]).toBe("Claro.");
    expect(all.join(" ").replace(/\s+/g, " ")).toBe(deltas.join("").trim().replace(/\s+/g, " "));
    expect(all.every((chunk) => chunk.length > 0)).toBe(true);
  });

  it("reset limpia el estado", () => {
    const chunker = new SentenceChunker(CFG);
    chunker.push("Hola, esto es una prueba completa.", 0);
    chunker.reset();
    expect(chunker.pendingText).toBe("");
    expect(chunker.emittedCount).toBe(0);
  });
});
