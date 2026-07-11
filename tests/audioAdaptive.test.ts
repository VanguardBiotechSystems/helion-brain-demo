import { describe, expect, it } from "vitest";
import { AudioGateEngine, DEFAULT_GATE_CONFIG } from "@/lib/audio/gateEngine";
import { evaluateWakeWord, DEFAULT_WAKE_WORD_CONFIG } from "@/lib/audio/wakeWord";
import { MockAudioFrontend } from "@/lib/audio/audioFrontend";

/** Alimenta el gate con un nivel constante durante ms, en pasos de 20 ms. */
function feed(gate: AudioGateEngine, startMs: number, durationMs: number, rms: number): number {
  let t = startMs;
  const end = startMs + durationMs;
  while (t < end) {
    gate.process(t, rms);
    t += 20;
  }
  return t;
}

/**
 * Ruido de fondo REALISTA y creciente: ráfagas cortas (140 ms < rechazo de
 * pico) que el gate descarta como no-voz, separadas por silencio. La media
 * sube por encima de 2× el suelo sin llegar a abrir el gate. Devuelve el
 * timestamp final.
 */
function feedNoisyDrift(gate: AudioGateEngine, startMs: number, durationMs: number): number {
  let t = startMs;
  const end = startMs + durationMs;
  while (t < end) {
    t = feed(gate, t, 140, 0.04); // ráfaga (rechazada como pico)
    t = feed(gate, t, 120, 0.006); // silencio entre ráfagas
  }
  return t;
}

describe("recalibración adaptativa por deriva (bloque 3 §11)", () => {
  it("no recalibra en condiciones normales (defaults intactos)", () => {
    const gate = new AudioGateEngine();
    gate.calibrate(0);
    let t = feed(gate, 0, DEFAULT_GATE_CONFIG.calibrationMs + 400, 0.01); // ruido bajo estable
    t = feed(gate, t, 10_000, 0.01);
    expect(gate.snapshot().recalibrations).toBe(0);
  });

  it("recalibra ante deriva sostenida ~30s, de forma gradual, sin abrir por ruido", () => {
    const gate = new AudioGateEngine();
    gate.calibrate(0);
    let t = feed(gate, 0, DEFAULT_GATE_CONFIG.calibrationMs + 400, 0.01);
    const before = gate.snapshot();
    t = feedNoisyDrift(gate, t, 35_000);
    const after = gate.snapshot();
    expect(after.recalibrations).toBeGreaterThanOrEqual(1);
    expect(after.threshold).toBeGreaterThan(before.threshold); // umbral subió
    expect(after.blockedNoises).toBeGreaterThan(0); // las ráfagas se rechazaron
  });

  it("no recalibra mientras Helion habla (no aprende su propia voz)", () => {
    const gate = new AudioGateEngine();
    gate.calibrate(0);
    let t = feed(gate, 0, DEFAULT_GATE_CONFIG.calibrationMs + 400, 0.01);
    gate.setAgentSpeaking(true);
    t = feedNoisyDrift(gate, t, 35_000);
    expect(gate.snapshot().recalibrations).toBe(0);
  });

  it("la deriva breve no dispara recalibración (histéresis/sostenido)", () => {
    const gate = new AudioGateEngine();
    gate.calibrate(0);
    let t = feed(gate, 0, DEFAULT_GATE_CONFIG.calibrationMs + 400, 0.01);
    t = feedNoisyDrift(gate, t, 8_000); // solo 8 s de deriva
    t = feed(gate, t, 8_000, 0.008); // vuelve a la calma
    expect(gate.snapshot().recalibrations).toBe(0);
  });

  it("se puede deshabilitar", () => {
    const gate = new AudioGateEngine({ ...DEFAULT_GATE_CONFIG, adaptiveRecalibration: false });
    gate.calibrate(0);
    let t = feed(gate, 0, DEFAULT_GATE_CONFIG.calibrationMs + 400, 0.01);
    t = feedNoisyDrift(gate, t, 35_000);
    expect(gate.snapshot().recalibrations).toBe(0);
  });
});

describe("wake word suave — contrato (bloque 3 §11)", () => {
  it("deshabilitado por defecto: nunca relaja aunque coincida", () => {
    const d = evaluateWakeWord({ partialTranscript: "Helion, ¿estás?", sessionListening: true, energy: 0.05, threshold: 0.02 });
    expect(d.matched).toBe(true);
    expect(d.relaxGate).toBe(false);
  });

  it("habilitado + escuchando + energía suficiente: relaja el umbral", () => {
    const cfg = { ...DEFAULT_WAKE_WORD_CONFIG, enabled: true };
    const d = evaluateWakeWord({ partialTranscript: "Helion ponme música", sessionListening: true, energy: 0.05, threshold: 0.02 }, cfg);
    expect(d.relaxGate).toBe(true);
    expect(d.effectiveThreshold).toBeLessThan(0.02);
  });

  it("no abre en silencio ni si la sesión no escucha", () => {
    const cfg = { ...DEFAULT_WAKE_WORD_CONFIG, enabled: true };
    expect(evaluateWakeWord({ partialTranscript: "helion", sessionListening: true, energy: 0.001, threshold: 0.02 }, cfg).relaxGate).toBe(false);
    expect(evaluateWakeWord({ partialTranscript: "helion", sessionListening: false, energy: 0.05, threshold: 0.02 }, cfg).relaxGate).toBe(false);
  });

  it("no relaja si el texto no empieza por la wake word", () => {
    const cfg = { ...DEFAULT_WAKE_WORD_CONFIG, enabled: true };
    expect(evaluateWakeWord({ partialTranscript: "hola qué tal", sessionListening: true, energy: 0.05, threshold: 0.02 }, cfg).matched).toBe(false);
  });
});

describe("AudioFrontend sustituible — contrato (bloque 3 §10)", () => {
  it("el mock cumple el ciclo de vida y emite eventos de voz vía el gate puro", async () => {
    const events: string[] = [];
    const front = new MockAudioFrontend();
    await front.init({
      onVoiceStart: () => events.push("start"),
      onVoiceStop: () => events.push("stop"),
      onStateChange: (s) => events.push(`state:${s}`),
    });
    expect(await front.requestPermission()).toBe("granted");
    await front.start();
    // Calibra y luego "habla": nivel alto sostenido abre el gate.
    let t = 0;
    for (; t < DEFAULT_GATE_CONFIG.calibrationMs; t += 20) front.feed(t, 0.01);
    for (let i = 0; i < 40; i++, t += 20) front.feed(t, 0.2); // voz
    expect(events).toContain("start");
    for (let i = 0; i < 60; i++, t += 20) front.feed(t, 0.001); // silencio
    expect(events).toContain("stop");
    await front.close();
    expect(front.getState()).toBe("closed");
  });

  it("permiso denegado y pérdida de dispositivo se comunican como errores", async () => {
    const denied = new MockAudioFrontend(DEFAULT_GATE_CONFIG, "denied");
    const errs: string[] = [];
    await denied.init({ onError: (e) => errs.push(e.code) });
    expect(await denied.requestPermission()).toBe("denied");
    expect(errs).toContain("permission");

    const lost = new MockAudioFrontend();
    const lostErrs: string[] = [];
    await lost.init({ onError: (e) => lostErrs.push(e.code) });
    lost.loseDevice();
    expect(lostErrs).toContain("lost");
    expect(lost.getActiveDevice()).toBeNull();
  });

  it("expone capacidades reservadas para hardware (beamforming, DOA, AEC propia)", () => {
    const caps = new MockAudioFrontend().getCapabilities();
    expect(caps).toHaveProperty("beamforming");
    expect(caps).toHaveProperty("directionOfArrival");
    expect(caps).toHaveProperty("selfVoiceSuppression");
  });
});
