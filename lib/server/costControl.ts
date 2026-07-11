/**
 * Control de uso y coste (bloque 3, §5). NO sustituye a la facturación real:
 * los paneles de OpenAI y ElevenLabs son la fuente autoritativa. Aquí
 * producimos ESTIMACIONES centralizadas y versionadas (nunca precios
 * repartidos por el código) para avisar antes de descubrir la factura.
 *
 * Nada corta una conversación sin aviso salvo emergencia de seguridad;
 * cuando se alcanza un límite, la UI lo explica de forma honesta y breve.
 */

export const COST_MODEL_VERSION = "2026-07-11";

/**
 * Tabla de estimaciones. Cifras aproximadas y actualizables (USD). Se
 * versiona con COST_MODEL_VERSION; si cambian precios, se sube la versión.
 * Deliberadamente conservadora y redondeada: es una estimación, no contable.
 */
export const PRICE_TABLE = {
  version: COST_MODEL_VERSION,
  currency: "USD" as const,
  openaiRealtime: {
    // gpt-realtime: audio in/out por minuto (estimación).
    audioInPerMin: 0.06,
    audioOutPerMin: 0.24,
  },
  elevenlabs: {
    // flash_v2_5: por 1000 caracteres sintetizados (estimación).
    ttsPer1kChars: 0.10,
  },
  openaiText: {
    // extracción/curación y fallback de texto (gpt-4.1-mini, por 1k tokens).
    per1kTokens: 0.001,
  },
} as const;

export interface SessionUsage {
  audioInMinutes?: number;
  audioOutMinutes?: number;
  ttsChars?: number;
  textTokens?: number;
}

/** Estima el coste de una sesión (USD). Redondeado a céntimos de céntimo. */
export function estimateSessionCost(usage: SessionUsage): number {
  const p = PRICE_TABLE;
  const cost =
    (usage.audioInMinutes ?? 0) * p.openaiRealtime.audioInPerMin +
    (usage.audioOutMinutes ?? 0) * p.openaiRealtime.audioOutPerMin +
    ((usage.ttsChars ?? 0) / 1000) * p.elevenlabs.ttsPer1kChars +
    ((usage.textTokens ?? 0) / 1000) * p.openaiText.per1kTokens;
  return Math.round(cost * 10000) / 10000;
}

export interface CostControlConfig {
  /** Aviso al owner al superar estas sesiones/día (0 = sin límite blando). */
  softDailySessions: number;
  /** Rechazo de nuevas sesiones al superar estas (0 = sin límite duro). */
  hardDailySessions: number;
  /** Duración máxima de una sesión (ms; 0 = sin límite). */
  maxSessionMs: number;
  /** Kill switch por proveedor: desactiva ese motor temporalmente. */
  killOpenai: boolean;
  killElevenlabs: boolean;
  /** El owner puede saltarse los límites blandos (no los de seguridad). */
  ownerExempt: boolean;
}

export interface UsageSnapshot {
  sessionsToday: number;
  estimatedCostToday: number;
}

export type CostAction = "ok" | "soft_alert" | "force_demo_estable" | "block_new_sessions";

export interface CostDecision {
  action: CostAction;
  /** Motivo técnico (panel), no para el usuario final. */
  reason: string;
  /** Si el modo de calidad debe caer a demo_estable. */
  downgradeVoice: boolean;
  /** Si se deben rechazar sesiones nuevas (excepto owner exento). */
  blockNew: boolean;
}

/**
 * Decide la acción de coste dado el uso de hoy y la config. Determinista y
 * testeable. El owner exento evita los límites blandos pero un kill switch
 * de proveedor SIEMPRE fuerza el downgrade (es una decisión operativa).
 */
export function decideCostAction(
  usage: UsageSnapshot,
  config: CostControlConfig,
  isOwner = false,
): CostDecision {
  if (config.killOpenai || config.killElevenlabs) {
    return {
      action: "force_demo_estable",
      reason: `kill switch activo (openai=${config.killOpenai}, elevenlabs=${config.killElevenlabs})`,
      downgradeVoice: config.killElevenlabs,
      blockNew: config.killOpenai,
    };
  }
  if (config.hardDailySessions > 0 && usage.sessionsToday >= config.hardDailySessions && !(isOwner && config.ownerExempt)) {
    return {
      action: "block_new_sessions",
      reason: `límite duro alcanzado (${usage.sessionsToday}/${config.hardDailySessions} sesiones)`,
      downgradeVoice: false,
      blockNew: true,
    };
  }
  if (config.softDailySessions > 0 && usage.sessionsToday >= config.softDailySessions && !(isOwner && config.ownerExempt)) {
    return {
      action: "force_demo_estable",
      reason: `límite blando alcanzado (${usage.sessionsToday}/${config.softDailySessions} sesiones): calidad_voz → demo_estable`,
      downgradeVoice: true,
      blockNew: false,
    };
  }
  return { action: "ok", reason: "dentro de límites", downgradeVoice: false, blockNew: false };
}
