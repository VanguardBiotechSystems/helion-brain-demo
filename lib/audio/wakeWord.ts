/**
 * Wake word suave "Helion" (bloque 3, §11) — SOPORTE ARQUITECTÓNICO, detrás
 * de feature flag y DESHABILITADO por defecto hasta validar con datos.
 *
 * Decisión documentada: NO construimos un detector de audio improvisado (eso
 * empeoraría la privacidad y añadiría complejidad desproporcionada). En su
 * lugar, esto es un HOOK de contrato puro: dada una transcripción PARCIAL ya
 * disponible (del propio pipeline STT) y el estado de sesión, decide si una
 * frase que empieza por "Helion" puede abrir el gate con menor energía. No
 * abre micrófono ni sesión por sí mismo, ni ante cualquier coincidencia
 * textual: exige controles (flag activo, sesión escuchando, energía mínima).
 */

export interface WakeWordConfig {
  /** Activado solo si el flag está on (por defecto false). */
  enabled: boolean;
  /** Palabra(s) de activación, normalizadas. */
  phrases: string[];
  /** Factor de reducción del umbral de energía cuando hay wake word (0..1). */
  energyRelax: number;
}

export const DEFAULT_WAKE_WORD_CONFIG: WakeWordConfig = {
  enabled: false,
  phrases: ["helion"],
  energyRelax: 0.6,
};

export interface WakeWordSignal {
  /** Transcripción parcial más reciente (puede ser vacía). */
  partialTranscript: string;
  /** ¿La sesión está en un estado que permite escuchar? */
  sessionListening: boolean;
  /** Energía RMS instantánea (0..1). */
  energy: number;
  /** Umbral de energía vigente del gate. */
  threshold: number;
}

export interface WakeWordDecision {
  /** ¿Se detectó la wake word al inicio de la frase parcial? */
  matched: boolean;
  /** ¿Debe relajarse el umbral para abrir antes el gate? */
  relaxGate: boolean;
  /** Umbral efectivo tras la relajación (o el original si no aplica). */
  effectiveThreshold: number;
  reason: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decisión pura y testeable. Aunque el texto empiece por "Helion", NO relaja
 * nada si el flag está off, la sesión no escucha o la energía es
 * insignificante: nunca abre ante una coincidencia textual sin más.
 */
export function evaluateWakeWord(signal: WakeWordSignal, config: WakeWordConfig = DEFAULT_WAKE_WORD_CONFIG): WakeWordDecision {
  const norm = normalize(signal.partialTranscript);
  const matched = config.phrases.some((p) => norm === p || norm.startsWith(`${normalize(p)} `));
  if (!config.enabled) {
    return { matched, relaxGate: false, effectiveThreshold: signal.threshold, reason: "wake word deshabilitado" };
  }
  if (!matched) {
    return { matched: false, relaxGate: false, effectiveThreshold: signal.threshold, reason: "sin coincidencia" };
  }
  if (!signal.sessionListening) {
    return { matched: true, relaxGate: false, effectiveThreshold: signal.threshold, reason: "sesión no escucha: no se abre" };
  }
  // Aun con coincidencia, exige una energía mínima real (no abre en silencio).
  const minEnergy = signal.threshold * 0.25;
  if (signal.energy < minEnergy) {
    return { matched: true, relaxGate: false, effectiveThreshold: signal.threshold, reason: "energía insuficiente" };
  }
  return {
    matched: true,
    relaxGate: true,
    effectiveThreshold: signal.threshold * config.energyRelax,
    reason: "wake word válida: umbral relajado",
  };
}
