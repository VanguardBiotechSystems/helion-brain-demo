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
  /** Recalibración adaptativa ante deriva sostenida del ruido de fondo. */
  adaptiveRecalibration: boolean;
  /** Deriva mínima (× sobre el suelo base) para plantear recalibrar. */
  driftFactor: number;
  /** La deriva debe sostenerse este tiempo antes de recalibrar (ms). */
  driftSustainMs: number;
}

export const DEFAULT_GATE_CONFIG: AudioGateConfig = {
  calibrationMs: 2000,
  minSpeechMs: 220,
  spikeRejectionMs: 160,
  thresholdMultiplier: 2.0,
  minThreshold: 0.008,
  exitMultiplier: 0.6,
  hangoverMs: 700,
  maxCandidateGapMs: 140,
  // Defaults afinados intactos: la recalibración solo actúa ante una deriva
  // real y sostenida (≈2× durante ≈30 s), nunca en el caso normal.
  adaptiveRecalibration: true,
  driftFactor: 2.0,
  driftSustainMs: 30_000,
};

export interface GateSnapshot {
  state: GateState;
  /** Voz CONFIRMADA (estado open o hangover): gobierna la UI "Escuchando". */
  open: boolean;
  /**
   * Pre-apertura de la pista hacia el modelo: true también durante la fase
   * candidate en cuanto la ráfaga supera spikeRejectionMs. Así el modelo
   * recibe el inicio de la frase (solo se pierden ~spikeRejectionMs) sin
   * dejar pasar los picos cortos confirmados; el VAD del servidor hace de
   * segundo filtro para el poco ruido sostenido que se cuele.
   */
  sendOpen: boolean;
  noiseFloor: number;
  threshold: number;
  /** Picos/ruidos bloqueados desde la última calibración. */
  blockedNoises: number;
  /** Último RMS procesado (0..1). */
  level: number;
  /** Recalibraciones automáticas por deriva desde el arranque. */
  recalibrations: number;
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
  // Recalibración adaptativa (§11): suelo base de referencia fijado en la
  // última (re)calibración, EWMA del ruido en idle e inicio de deriva.
  private baselineNoiseFloor = 0;
  private idleEwma = 0;
  private driftStart: number | null = null;
  private recalibrations = 0;
  private agentSpeaking = false;

  constructor(private readonly config: AudioGateConfig = DEFAULT_GATE_CONFIG) {}

  /** Reinicia la calibración de ruido ambiente. */
  calibrate(now: number): void {
    this.state = "calibrating";
    this.calibrationStart = now;
    this.calibrationSamples = [];
    this.blockedNoises = 0;
    this.driftStart = null;
  }

  /**
   * Pausa la adaptación mientras Helion habla: su voz (por eco/altavoz) no
   * debe aprenderse como ruido de fondo. La UI lo activa al reproducir.
   */
  setAgentSpeaking(speaking: boolean): void {
    this.agentSpeaking = speaking;
    if (speaking) this.driftStart = null; // cancela cualquier deriva en curso
  }

  /**
   * Recalibración adaptativa (§11). Solo en idle, con el gate cerrado y con
   * Helion callado: así nunca aprende voz (candidate/open quedan fuera) ni el
   * eco del propio altavoz. Requiere que el ruido de fondo (EWMA de las
   * muestras idle) supere baseline × driftFactor de forma SOSTENIDA
   * (driftSustainMs). Con histéresis: la deriva se cancela si el ruido baja
   * del 80% del umbral de disparo. La subida del suelo es GRADUAL (mitad del
   * camino) y acotada, para no desbocarse.
   */
  private trackDrift(now: number, rms: number): void {
    const { config } = this;
    // No adapta con voz confirmada ni mientras Helion habla: así el suelo de
    // ruido no incorpora ni la voz del usuario ni el eco del altavoz.
    if (!config.adaptiveRecalibration || this.agentSpeaking || this.state === "open" || this.state === "hangover") {
      this.driftStart = null;
      return;
    }
    if (this.baselineNoiseFloor <= 0) return; // aún sin calibrar
    // EWMA lenta del ruido de fondo (robusta a picos sueltos).
    this.idleEwma = this.idleEwma * 0.98 + rms * 0.02;
    const trigger = this.baselineNoiseFloor * config.driftFactor;
    const release = trigger * 0.8; // banda de histéresis

    if (this.idleEwma >= trigger) {
      if (this.driftStart === null) this.driftStart = now;
      else if (now - this.driftStart >= config.driftSustainMs) {
        // Recalibración gradual: mover el suelo a mitad de camino del ruido
        // observado, acotado a 4× el baseline para no desbocarse.
        const target = Math.min(this.idleEwma, this.baselineNoiseFloor * 4);
        this.noiseFloor = this.noiseFloor * 0.5 + target * 0.5;
        this.threshold = Math.max(this.noiseFloor * config.thresholdMultiplier, config.minThreshold);
        this.baselineNoiseFloor = this.noiseFloor;
        this.recalibrations += 1;
        this.driftStart = null;
      }
    } else if (this.idleEwma < release) {
      this.driftStart = null; // el ruido volvió: se cancela la deriva
    }
  }

  snapshot(): GateSnapshot {
    const confirmed = this.state === "open" || this.state === "hangover";
    const candidateBurstMs =
      this.state === "candidate" ? this.lastAboveThreshold - this.candidateStart : 0;
    return {
      state: this.state,
      open: confirmed,
      sendOpen:
        confirmed || (this.state === "candidate" && candidateBurstMs >= this.config.spikeRejectionMs),
      noiseFloor: this.noiseFloor,
      threshold: this.threshold,
      blockedNoises: this.blockedNoises,
      level: this.lastLevel,
      recalibrations: this.recalibrations,
    };
  }

  /** Procesa una muestra RMS con su timestamp (ms monotónicos). */
  process(now: number, rms: number): GateSnapshot {
    this.lastLevel = rms;
    const { config } = this;

    // Deriva del ruido de fondo: se rastrea en todas las fases salvo con voz
    // CONFIRMADA (open/hangover) o mientras Helion habla — así nunca aprende
    // voz ni el eco propio. La recalibración se aplica solo con el gate
    // cerrado (idle/candidate), no interrumpe una frase en curso.
    if (this.state !== "calibrating") this.trackDrift(now, rms);

    switch (this.state) {
      case "calibrating": {
        if (this.calibrationStart === null) this.calibrationStart = now;
        this.calibrationSamples.push(rms);
        if (now - this.calibrationStart >= config.calibrationMs) {
          // p75: robusto frente a algún pico durante la calibración.
          this.noiseFloor = percentile(this.calibrationSamples, 0.75);
          this.threshold = Math.max(this.noiseFloor * config.thresholdMultiplier, config.minThreshold);
          this.baselineNoiseFloor = this.noiseFloor;
          this.idleEwma = this.noiseFloor;
          this.driftStart = null;
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
