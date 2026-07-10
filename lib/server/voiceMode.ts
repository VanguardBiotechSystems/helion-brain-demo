import type { AppEnv } from "./env";
import { logError } from "./log";

/**
 * Política de modos de voz — decisión de arquitectura (no oscilar más):
 * - demo_estable: OpenAI Realtime. Defecto para demos en vivo.
 * - calidad_voz: ElevenLabs vía streaming HTTP ya implementado.
 * - futuro_gateway: RESERVADO (gateway persistente con WS caliente); no
 *   operativo — seleccionarlo cae a demo_estable con log.
 * Decisión explícita: NO hay modo híbrido OpenAI-corto/ElevenLabs-largo;
 * dos voces en una misma entidad rompen la continuidad de identidad.
 */
export type VoiceMode = "demo_estable" | "calidad_voz" | "futuro_gateway";

export interface ResolvedVoiceMode {
  mode: Exclude<VoiceMode, "futuro_gateway">;
  requested: string;
  fallback: boolean;
}

export function resolveVoiceMode(env: AppEnv, requestedRaw?: string): ResolvedVoiceMode {
  const requested = (requestedRaw ?? process.env.HELION_VOICE_MODE ?? "").trim() || "(derivado)";
  if (requested === "futuro_gateway") {
    logError("voice", "HELION_VOICE_MODE=futuro_gateway no está operativo: fallback a demo_estable");
    return { mode: "demo_estable", requested, fallback: true };
  }
  if (requested !== "(derivado)" && requested !== "demo_estable" && requested !== "calidad_voz") {
    logError("voice", `HELION_VOICE_MODE inválido ('${requested}'): fallback derivado del motor`);
  }
  const derived: ResolvedVoiceMode["mode"] =
    env.voiceEngine === "elevenlabs" ? "calidad_voz" : "demo_estable";
  if (requested === "demo_estable" || requested === "calidad_voz") {
    const consistent =
      (requested === "calidad_voz") === (env.voiceEngine === "elevenlabs");
    if (!consistent) {
      logError("voice", `HELION_VOICE_MODE='${requested}' incoherente con VOICE_ENGINE: manda el motor`);
      return { mode: derived, requested, fallback: true };
    }
    return { mode: requested, requested, fallback: false };
  }
  return { mode: derived, requested, fallback: false };
}
