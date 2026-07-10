import { describe, expect, it } from "vitest";
import {
  AudioGateEngine,
  DEFAULT_GATE_CONFIG,
  percentile,
  rmsFromTimeDomain,
  type AudioGateConfig,
} from "@/lib/audio/gateEngine";

const CONFIG: AudioGateConfig = { ...DEFAULT_GATE_CONFIG };
const STEP = 20; // ms entre muestras, como el polling real

/** Alimenta el motor con `ms` milisegundos de un nivel RMS constante. */
function feed(engine: AudioGateEngine, startAt: number, ms: number, rms: number): number {
  let t = startAt;
  for (; t < startAt + ms; t += STEP) {
    engine.process(t, rms);
  }
  return t;
}

function calibrated(noise = 0.004): { engine: AudioGateEngine; t: number } {
  const engine = new AudioGateEngine(CONFIG);
  engine.calibrate(0);
  const t = feed(engine, 0, CONFIG.calibrationMs + STEP * 2, noise);
  return { engine, t };
}

describe("rmsFromTimeDomain", () => {
  it("silencio digital (128) da 0", () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(128))).toBe(0);
  });

  it("señal a fondo de escala da ~1", () => {
    expect(rmsFromTimeDomain(new Uint8Array(64).fill(255))).toBeCloseTo(0.992, 2);
  });
});

describe("percentile", () => {
  it("devuelve el valor correcto", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([], 0.75)).toBe(0);
  });
});

describe("AudioGateEngine — calibración y umbral dinámico", () => {
  it("calibra el ruido de fondo y fija el umbral por encima", () => {
    const { engine } = calibrated(0.004);
    const snap = engine.snapshot();
    expect(snap.state).toBe("idle");
    expect(snap.noiseFloor).toBeCloseTo(0.004, 3);
    // max(0.004 × 2.5, minThreshold 0.01) = 0.01
    expect(snap.threshold).toBeCloseTo(0.01, 3);
  });

  it("en una sala ruidosa el umbral sube proporcionalmente", () => {
    const { engine } = calibrated(0.02);
    expect(engine.snapshot().threshold).toBeCloseTo(0.05, 3);
  });

  it("el suelo de ruido se adapta lentamente en idle", () => {
    const { engine, t } = calibrated(0.004);
    const before = engine.snapshot().threshold;
    feed(engine, t, 30000, 0.009); // ambiente algo más ruidoso, bajo umbral
    expect(engine.snapshot().threshold).toBeGreaterThan(before);
    expect(engine.snapshot().state).toBe("idle");
  });

  it("calibrate() reinicia el estado y los contadores", () => {
    const { engine, t } = calibrated();
    feed(engine, t, 100, 0.5); // pico
    engine.calibrate(t + 200);
    const snap = engine.snapshot();
    expect(snap.state).toBe("calibrating");
    expect(snap.blockedNoises).toBe(0);
  });
});

describe("AudioGateEngine — rechazo de ruido", () => {
  it("un golpe de tecla (pico de ~100 ms) NO abre el gate y se contabiliza", () => {
    const { engine, t } = calibrated();
    const afterSpike = feed(engine, t, 100, 0.3); // pico fuerte y breve
    feed(engine, afterSpike, 400, 0.002); // vuelve el silencio
    const snap = engine.snapshot();
    expect(snap.state).toBe("idle");
    expect(snap.open).toBe(false);
    expect(snap.blockedNoises).toBe(1);
  });

  it("ruido sostenido pero corto (200 ms < minSpeechMs) tampoco abre", () => {
    const { engine, t } = calibrated();
    feed(engine, t, 200, 0.2);
    feed(engine, t + 200, 400, 0.002);
    expect(engine.snapshot().open).toBe(false);
    expect(engine.snapshot().blockedNoises).toBe(1);
  });

  it("una ráfaga de tecleo (varios picos) acumula bloqueos sin abrir", () => {
    const { engine, t } = calibrated();
    let now = t;
    for (let i = 0; i < 5; i++) {
      now = feed(engine, now, 80, 0.25); // tecla
      now = feed(engine, now, 300, 0.002); // pausa
    }
    const snap = engine.snapshot();
    expect(snap.open).toBe(false);
    expect(snap.blockedNoises).toBe(5);
  });
});

describe("AudioGateEngine — detección de voz", () => {
  it("voz sostenida abre el gate tras minSpeechMs", () => {
    const { engine, t } = calibrated();
    feed(engine, t, CONFIG.minSpeechMs - 40, 0.08);
    expect(engine.snapshot().state).toBe("candidate");
    feed(engine, t + CONFIG.minSpeechMs - 40, 100, 0.08);
    expect(engine.snapshot().open).toBe(true);
  });

  it("tolera huecos breves dentro de la voz (sílabas)", () => {
    const { engine, t } = calibrated();
    let now = feed(engine, t, 200, 0.08); // primer segmento de voz (> spikeRejectionMs)
    now = feed(engine, now, 100, 0.004); // hueco < maxCandidateGapMs
    feed(engine, now, 200, 0.08); // sigue hablando
    expect(engine.snapshot().open).toBe(true);
  });

  it("el tecleo rápido no encadena picos hasta abrir el gate", () => {
    const { engine, t } = calibrated();
    let now = t;
    // ~9 pulsaciones/s: picos de 50 ms con huecos de 90 ms.
    for (let i = 0; i < 10; i++) {
      now = feed(engine, now, 50, 0.25);
      now = feed(engine, now, 90, 0.002);
    }
    const snap = engine.snapshot();
    expect(snap.open).toBe(false);
    expect(snap.blockedNoises).toBeGreaterThanOrEqual(8);
  });

  it("hangover: mantiene abierto un margen al dejar de hablar y luego cierra", () => {
    const { engine, t } = calibrated();
    let now = feed(engine, t, 500, 0.08); // voz confirmada
    expect(engine.snapshot().open).toBe(true);
    // Cae la energía: sigue abierto durante el hangover…
    now = feed(engine, now, 300, 0.002);
    expect(engine.snapshot().open).toBe(true);
    // …y cierra pasado hangoverMs (+ margen de gracia de 200 ms).
    feed(engine, now, CONFIG.hangoverMs + 400, 0.002);
    expect(engine.snapshot().state).toBe("idle");
    expect(engine.snapshot().open).toBe(false);
  });

  it("si vuelve la voz durante el hangover, reabre sin pasar por candidate", () => {
    const { engine, t } = calibrated();
    let now = feed(engine, t, 500, 0.08);
    now = feed(engine, now, 350, 0.002); // entra en hangover
    feed(engine, now, 60, 0.08); // vuelve la voz
    expect(engine.snapshot().state).toBe("open");
  });

  it("la voz no incrementa el contador de ruidos bloqueados", () => {
    const { engine, t } = calibrated();
    feed(engine, t, 800, 0.08);
    expect(engine.snapshot().blockedNoises).toBe(0);
  });
});
