import { AudioGateEngine, DEFAULT_GATE_CONFIG, type AudioGateConfig, type GateSnapshot } from "./gateEngine";

/**
 * AudioFrontend (bloque 3, §10): interfaz que DESACOPLA el sistema cognitivo
 * y el motor del gate del ORIGEN físico del audio. El navegador es una
 * implementación (BrowserAudioFrontend); un futuro hardware (micro array con
 * beamforming, AEC, DSP, dirección de llegada, supresión de la voz propia)
 * sería otra que cumpla el mismo contrato, sin tocar la lógica cognitiva.
 *
 * El motor del gate (gateEngine.ts) es PURO y se mantiene separado y
 * testeable: el frontend solo lo alimenta con muestras RMS + timestamps.
 */

export type AudioFrontendKind = "browser" | "hardware" | "mock";

export type AudioFrontendState =
  | "uninitialized"
  | "permission_pending"
  | "ready"
  | "running"
  | "paused"
  | "closed"
  | "error";

export interface AudioFrontendCapabilities {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** Reservado para hardware: array de micros con conformación de haz. */
  beamforming: boolean;
  /** Reservado para hardware: estimación de dirección de llegada. */
  directionOfArrival: boolean;
  /** Reservado para hardware: supresión de la propia voz del robot (AEC ref). */
  selfVoiceSuppression: boolean;
}

export type PermissionOutcome = "granted" | "denied" | "unavailable" | "unsupported";

export interface AudioFrontendError {
  code: "permission" | "unavailable" | "lost" | "unsupported" | "internal";
  message: string;
}

export interface AudioFrontendEvents {
  /** Nivel RMS suavizado 0..1 (para el orbe). */
  onLevel?: (rms: number) => void;
  /** Snapshot del gate cada vez que cambia de estado. */
  onGate?: (snapshot: GateSnapshot) => void;
  /** Voz confirmada empieza (gate open). */
  onVoiceStart?: () => void;
  /** Voz confirmada termina. */
  onVoiceStop?: () => void;
  onDeviceChange?: (deviceLabel: string | null) => void;
  onError?: (error: AudioFrontendError) => void;
  onStateChange?: (state: AudioFrontendState) => void;
}

export interface AudioFrontend {
  readonly kind: AudioFrontendKind;
  init(events?: AudioFrontendEvents): Promise<void>;
  requestPermission(): Promise<PermissionOutcome>;
  start(): Promise<void>;
  pause(): void;
  close(): Promise<void>;
  /** Último RMS suavizado (0..1). */
  readLevel(): number;
  getState(): AudioFrontendState;
  getCapabilities(): AudioFrontendCapabilities;
  getActiveDevice(): string | null;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  /** Reinicia la calibración de ruido del gate. */
  calibrate(): void;
  /** Último snapshot del gate (estado, umbral, ruidos bloqueados…). */
  gateSnapshot(): GateSnapshot | null;
  /**
   * Fuente de audio para el transporte (WebRTC en navegador). null en
   * implementaciones que no exponen MediaStream (p. ej. hardware con su
   * propio pipeline). El sistema cognitivo NO debe asumir que existe.
   */
  getStream(): MediaStream | null;
}

/**
 * Implementación de referencia sin dependencias del navegador para tests y
 * E2E deterministas. Se le inyectan muestras y produce eventos de gate reales
 * a través del motor puro. Un E2E puede simular ruido/voz sin micrófono.
 */
export class MockAudioFrontend implements AudioFrontend {
  readonly kind = "mock" as const;
  private state: AudioFrontendState = "uninitialized";
  private events: AudioFrontendEvents = {};
  private gate: AudioGateEngine;
  private level = 0;
  private muted = false;
  private lastGate: GateSnapshot | null = null;
  private wasOpen = false;
  private permission: PermissionOutcome;

  constructor(
    private readonly config: AudioGateConfig = DEFAULT_GATE_CONFIG,
    permission: PermissionOutcome = "granted",
    private device: string | null = "mock-mic",
  ) {
    this.permission = permission;
    this.gate = new AudioGateEngine(config);
  }

  private setState(s: AudioFrontendState): void {
    this.state = s;
    this.events.onStateChange?.(s);
  }

  async init(events: AudioFrontendEvents = {}): Promise<void> {
    this.events = events;
    this.setState("ready");
  }

  async requestPermission(): Promise<PermissionOutcome> {
    this.setState(this.permission === "granted" ? "ready" : "error");
    if (this.permission !== "granted") {
      this.events.onError?.({ code: this.permission === "denied" ? "permission" : "unavailable", message: this.permission });
    }
    return this.permission;
  }

  async start(): Promise<void> {
    this.gate.calibrate(0);
    this.setState("running");
  }

  pause(): void {
    this.setState("paused");
  }

  async close(): Promise<void> {
    this.setState("closed");
  }

  /** Inyecta una muestra RMS con timestamp (solo mock/tests). */
  feed(now: number, rms: number): GateSnapshot {
    this.level = this.muted ? 0 : rms;
    const snap = this.gate.process(now, this.muted ? 0 : rms);
    this.lastGate = snap;
    this.events.onLevel?.(this.level);
    this.events.onGate?.(snap);
    if (snap.open && !this.wasOpen) this.events.onVoiceStart?.();
    if (!snap.open && this.wasOpen) this.events.onVoiceStop?.();
    this.wasOpen = snap.open;
    return snap;
  }

  /** Simula la desaparición del dispositivo. */
  loseDevice(): void {
    this.device = null;
    this.events.onDeviceChange?.(null);
    this.events.onError?.({ code: "lost", message: "dispositivo perdido" });
    this.setState("error");
  }

  readLevel(): number {
    return this.level;
  }
  getState(): AudioFrontendState {
    return this.state;
  }
  getCapabilities(): AudioFrontendCapabilities {
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      beamforming: false,
      directionOfArrival: false,
      selfVoiceSuppression: false,
    };
  }
  getActiveDevice(): string | null {
    return this.device;
  }
  isMuted(): boolean {
    return this.muted;
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  calibrate(): void {
    this.gate.calibrate(0);
  }
  gateSnapshot(): GateSnapshot | null {
    return this.lastGate;
  }
  getStream(): MediaStream | null {
    return null;
  }
}
