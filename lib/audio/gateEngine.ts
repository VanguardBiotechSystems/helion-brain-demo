/**
 * Motor del gate de audio local: lógica PURA (sin Web Audio ni WebRTC),
 * alimentada con muestras RMS y timestamps. Decide cuándo lo que entra por
 * el micrófono parece voz humana sostenida y cuándo es ruido (tecleo,
 * golpes, roces). Se testea unitariamente en tests/gateEngine.test.ts.
 *
 * Estados:
 *   calibrating → midiendo el ruido de fondo de la habitación
 *   idle        → en espera; energía por debajo del umbral dinámico
 *   candidate   → energía sostenida detectada, confirmando que es voz
 *   open        → voz confirmada: el audio fluye hacia el modelo
 *   hangover    → la voz cesó; margen para no cortar finales de palabra
 */

export type GateState = "calibrating" | "idle" | "candidate" | "open" | "hangover";

export interface AudioGateConfig {
  /** Duración de la calibración de ruido ambiente (ms). */
  calibrationMs: number;
  /** Energía sostenida mínima para confirmar voz y abrir el gate (ms). */
  minSpeechMs: number;
  /** Picos más cortos que esto son ruido seguro (tecla, golpe) (ms). */
  spikeRejectionMs: number;
  /** Umbral = max(noiseFloor × multiplier, minThreshold). */
  thresholdMultiplier: number;
  /** Suelo absoluto del umbral RMS (por si la sala es casi silente). */
  minThreshold: number;
  /** Histéresis: umbral de salida = umbral × exitMultiplier. */
  exitMultiplier: number;
  /** Tiempo abierto tras caer la energía, para no cortar palabras (ms). */
  hangoverMs: number;
  /** Huecos breves tolerados dentro de un candidato a voz (ms). */
  maxCandidateGapMs: number;
}

export const DEFAULT_GATE_CONFIG: AudioGateConfig = {
  calibrationMs: 2000,
  minSpeechMs: 300,
  spikeRejectionMs: 180,
  thresholdMultiplier: 2.5,
  minThreshold: 0.01,
  exitMultiplier: 0.6,
  hangoverMs: 700,
  maxCandidateGapMs: 140,
};

export interface GateSnapshot {
  state: GateState;
  /** true si el audio debe fluir hacia el modelo (open o hangover). */
  open: boolean;
  noiseFloor: number;
  threshold: number;
  /** Picos/ruidos bloqueados desde la última calibración. */
  blockedNoises: number;
  /** Último RMS procesado (0..1). */
  level: number;
}

/** RMS de un buffer de dominio temporal de un AnalyserNode (bytes 0-255). */
export function rmsFromTimeDomain(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/** Percentil simple sobre una copia ordenada (p en 0..1). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index];
}

export class AudioGateEngine {
  private state: GateState = "calibrating";
  private calibrationStart: number | null = null;
  private calibrationSamples: number[] = [];
  private noiseFloor = 0;
  private threshold = Number.POSITIVE_INFINITY;
  private candidateStart = 0;
  private lastAboveThreshold = 0;
  private lastAboveExit = 0;
  private hangoverStart = 0;
  private blockedNoises = 0;
  private lastLevel = 0;

  constructor(private readonly config: AudioGateConfig = DEFAULT_GATE_CONFIG) {}

  /** Reinicia la calibración de ruido ambiente. */
  calibrate(now: number): void {
    this.state = "calibrating";
    this.calibrationStart = now;
    this.calibrationSamples = [];
    this.blockedNoises = 0;
  }

  snapshot(): GateSnapshot {
    return {
      state: this.state,
      open: this.state === "open" || this.state === "hangover",
      noiseFloor: this.noiseFloor,
      threshold: this.threshold,
      blockedNoises: this.blockedNoises,
      level: this.lastLevel,
    };
  }

  /** Procesa una muestra RMS con su timestamp (ms monotónicos). */
  process(now: number, rms: number): GateSnapshot {
    this.lastLevel = rms;
    const { config } = this;

    switch (this.state) {
      case "calibrating": {
        if (this.calibrationStart === null) this.calibrationStart = now;
        this.calibrationSamples.push(rms);
        if (now - this.calibrationStart >= config.calibrationMs) {
          // p75: robusto frente a algún pico durante la calibración.
          this.noiseFloor = percentile(this.calibrationSamples, 0.75);
          this.threshold = Math.max(this.noiseFloor * config.thresholdMultiplier, config.minThreshold);
          this.state = "idle";
        }
        break;
      }

      case "idle": {
        if (rms >= this.threshold) {
          this.state = "candidate";
          this.candidateStart = now;
          this.lastAboveThreshold = now;
        } else {
          // Adaptación lenta del suelo de ruido al ambiente actual.
          this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;
          this.threshold = Math.max(this.noiseFloor * config.thresholdMultiplier, config.minThreshold);
        }
        break;
      }

      case "candidate": {
        if (rms >= this.threshold) {
          this.lastAboveThreshold = now;
          if (now - this.candidateStart >= config.minSpeechMs) {
            this.state = "open";
            this.lastAboveExit = now;
          }
        } else {
          // Ráfagas más cortas que spikeRejectionMs (tecla, golpe) se
          // rechazan casi al instante: sin esta distinción, el tecleo
          // rápido encadenaría picos vía la tolerancia de huecos y
          // acabaría abriendo el gate. La voz real (segmentos sostenidos)
          // conserva la tolerancia amplia para los huecos entre sílabas.
          const burstMs = this.lastAboveThreshold - this.candidateStart;
          const gapAllowance =
            burstMs < config.spikeRejectionMs
              ? Math.min(60, config.maxCandidateGapMs)
              : config.maxCandidateGapMs;
          if (now - this.lastAboveThreshold > gapAllowance) {
            this.blockedNoises += 1;
            this.state = "idle";
          }
        }
        break;
      }

      case "open": {
        const exitThreshold = this.threshold * this.config.exitMultiplier;
        if (rms >= exitThreshold) {
          this.lastAboveExit = now;
        } else if (now - this.lastAboveExit > 200) {
          this.state = "hangover";
          this.hangoverStart = now;
        }
        break;
      }

      case "hangover": {
        if (rms >= this.threshold) {
          this.state = "open";
          this.lastAboveExit = now;
        } else if (now - this.hangoverStart >= config.hangoverMs) {
          this.state = "idle";
        }
        break;
      }
    }

    return this.snapshot();
  }
}
