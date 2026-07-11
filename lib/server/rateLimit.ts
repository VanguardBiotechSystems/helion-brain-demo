/**
 * Rate limiting en memoria con ventana deslizante.
 *
 * Limitación conocida: en plataformas serverless con varias instancias,
 * cada instancia mantiene su propio contador (mejor esfuerzo). Para una
 * demo con pocos usuarios es suficiente; el endurecimiento con un store
 * compartido (p. ej. Upstash Redis) está documentado en el README.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now: number = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: Math.max(0, recent[0] + this.windowMs - now) };
    }

    recent.push(now);
    this.hits.set(key, recent);
    this.cleanup(cutoff);
    return { allowed: true, retryAfterMs: 0 };
  }

  private cleanup(cutoff: number): void {
    if (this.hits.size <= 1000) return;
    for (const [key, times] of this.hits) {
      if (!times.some((t) => t > cutoff)) this.hits.delete(key);
    }
  }
}

type LimiterRegistry = Record<string, SlidingWindowLimiter>;

// globalThis para sobrevivir al hot-reload en desarrollo y reutilizar
// contadores entre peticiones dentro de una misma instancia.
const globalStore = globalThis as unknown as {
  __helionLimiters?: LimiterRegistry;
  __helionRateBlocks?: Record<string, number>;
};

export function getLimiter(name: string, limit: number, windowMs: number): SlidingWindowLimiter {
  const registry = (globalStore.__helionLimiters ??= {});
  registry[name] ??= new SlidingWindowLimiter(limit, windowMs);
  return registry[name];
}

/**
 * Abstracción de RateLimiter preparada para varias instancias (bloque 3, §4).
 *
 * Tabla ÚNICA de límites por namespace: elimina el bug de `getLimiter` (que
 * cacheaba por nombre e ignoraba límites posteriores, dando límites no
 * deterministas cuando dos rutas compartían nombre). Cada endpoint costoso
 * tiene su propio namespace y límite explícito.
 *
 * La implementación por defecto es local/in-memory (una instancia). Una
 * implementación distribuida (Redis/Upstash) es opcional; su ausencia en
 * modo producción-distribuida NO pasa en silencio: `rateLimiterReadiness()`
 * lo marca como crítico para el readiness del despliegue.
 */
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const MIN = 60_000;

/** Fuente de verdad de límites diferenciados por operación. */
export const RATE_LIMITS = {
  // Autenticación y acceso (protegen contra fuerza bruta y enumeración).
  login: { limit: 10, windowMs: 15 * MIN },
  // Red de seguridad IP-INDEPENDIENTE contra brute force con IP spoofeada:
  // un tope global de intentos de acceso por ventana.
  "login-global": { limit: 100, windowMs: 15 * MIN },
  access_pin: { limit: 8, windowMs: 15 * MIN },
  identity: { limit: 30, windowMs: 10 * MIN },
  // Sesión y voz (protegen la factura).
  "session-ip": { limit: 10, windowMs: 10 * MIN },
  "session-global": { limit: 40, windowMs: 10 * MIN },
  chat: { limit: 30, windowMs: 10 * MIN },
  tts: { limit: 240, windowMs: 10 * MIN },
  "voice-test": { limit: 10, windowMs: 10 * MIN },
  // Memoria y herramientas.
  "memory-read": { limit: 120, windowMs: 10 * MIN },
  "memory-write": { limit: 60, windowMs: 10 * MIN },
  "memory-extract": { limit: 30, windowMs: 10 * MIN },
  "memory-confirm": { limit: 60, windowMs: 10 * MIN },
  consolidate: { limit: 10, windowMs: 10 * MIN },
  profiles: { limit: 60, windowMs: 10 * MIN },
  // Observabilidad (endpoints públicos: límites más estrictos por IP).
  telemetry: { limit: 60, windowMs: 10 * MIN },
  "client-error": { limit: 30, windowMs: 10 * MIN },
  // Debug/ops.
  ops: { limit: 120, windowMs: 10 * MIN },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitNamespace = keyof typeof RATE_LIMITS;

export interface EnforceResult extends RateLimitResult {
  namespace: string;
  limit: number;
}

/**
 * Aplica el límite del namespace a una clave (IP o token). Registra los
 * bloqueos para el panel operativo. La política de fallo es FAIL-OPEN
 * deliberada (un fallo del limitador no debe tumbar el servicio); los
 * bloqueos se cuentan para detectar abuso.
 */
export function enforceRateLimit(namespace: RateLimitNamespace, key: string, now: number = Date.now()): EnforceResult {
  const rule = RATE_LIMITS[namespace];
  const result = getLimiter(namespace, rule.limit, rule.windowMs).check(key, now);
  if (!result.allowed) {
    const blocks = (globalStore.__helionRateBlocks ??= {});
    blocks[namespace] = (blocks[namespace] ?? 0) + 1;
  }
  return { ...result, namespace, limit: rule.limit };
}

/** Bloqueos acumulados por namespace (para el panel operativo). */
export function rateLimitBlocks(): Record<string, number> {
  return { ...(globalStore.__helionRateBlocks ?? {}) };
}

export type DeploymentMode = "development" | "demo" | "production";

/** Modo de despliegue declarado (governa la política de readiness). */
export function deploymentMode(source: Record<string, string | undefined> = process.env): DeploymentMode {
  const raw = source.HELION_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (raw === "production" || raw === "demo" || raw === "development") return raw;
  // Sin declarar: en Vercel producción asumimos demo de una instancia salvo
  // que se declare production explícitamente.
  return source.NODE_ENV === "production" ? "demo" : "development";
}

/** ¿Hay un limitador distribuido configurado (Redis/Upstash)? */
export function distributedLimiterConfigured(source: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    (source.UPSTASH_REDIS_REST_URL && source.UPSTASH_REDIS_REST_TOKEN) || source.RATE_LIMIT_REDIS_URL,
  );
}

export interface RateLimiterReadiness {
  ready: boolean;
  mode: DeploymentMode;
  distributed: boolean;
  severity: "ok" | "warning" | "critical";
  message: string;
}

/**
 * Readiness del rate limiting (bloque 3, §4). En producción distribuida sin
 * store compartido: CRÍTICO (los límites por-instancia no protegen de
 * verdad). En demo: aviso. En desarrollo: ok.
 */
export function rateLimiterReadiness(source: Record<string, string | undefined> = process.env): RateLimiterReadiness {
  const mode = deploymentMode(source);
  const distributed = distributedLimiterConfigured(source);
  if (distributed) {
    return { ready: true, mode, distributed, severity: "ok", message: "Limitador distribuido configurado." };
  }
  if (mode === "production") {
    return {
      ready: false,
      mode,
      distributed,
      severity: "critical",
      message:
        "Producción distribuida SIN limitador compartido: los límites son por-instancia y no protegen de verdad. " +
        "Configura UPSTASH_REDIS_REST_URL/TOKEN o declara HELION_DEPLOYMENT_MODE=demo.",
    };
  }
  return {
    ready: true,
    mode,
    distributed,
    severity: mode === "demo" ? "warning" : "ok",
    message:
      mode === "demo"
        ? "Demo de una instancia: rate limiting en memoria (suficiente para una instancia)."
        : "Desarrollo: rate limiting en memoria.",
  };
}

/**
 * Extrae la IP del cliente detrás de proxies. SEGURIDAD (bloque 4): el
 * PRIMER valor de X-Forwarded-For es controlable por el cliente (los proxies
 * lo APENDEAN), así que un atacante podría rotarlo para evadir el rate limit.
 * Por eso se prefiere `x-real-ip` (lo fija la plataforma, valor único) y solo
 * como último recurso el XFF. Aun así, los límites sensibles (login) tienen
 * ADEMÁS un tope global independiente de IP como red de seguridad.
 */
export function clientIpFrom(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
