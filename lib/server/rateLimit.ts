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
const globalStore = globalThis as unknown as { __helionLimiters?: LimiterRegistry };

export function getLimiter(name: string, limit: number, windowMs: number): SlidingWindowLimiter {
  const registry = (globalStore.__helionLimiters ??= {});
  registry[name] ??= new SlidingWindowLimiter(limit, windowMs);
  return registry[name];
}

/** Extrae la IP del cliente detrás de proxies (Vercel/Render/Railway). */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
