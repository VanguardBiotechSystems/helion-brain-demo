import { describe, expect, it } from "vitest";
import {
  enforceRateLimit,
  rateLimiterReadiness,
  deploymentMode,
  distributedLimiterConfigured,
  RATE_LIMITS,
  rateLimitBlocks,
} from "@/lib/server/rateLimit";

describe("RateLimiter abstracto (bloque 3 §4)", () => {
  it("tabla única de límites sin colisiones de nombre", () => {
    // Cada namespace tiene un único límite (el bug de getLimiter por nombre
    // queda resuelto: ya no hay dos rutas con el mismo nombre y límites
    // distintos).
    expect(RATE_LIMITS.tts.limit).toBe(240);
    expect(RATE_LIMITS["memory-extract"].limit).toBe(30);
    expect(RATE_LIMITS.consolidate.limit).toBe(10);
    expect(RATE_LIMITS.telemetry.limit).toBe(60);
  });

  it("aplica el límite del namespace y registra bloqueos", () => {
    const ns = "voice-test" as const;
    const key = `test-${Math.random()}`;
    const rule = RATE_LIMITS[ns];
    let lastAllowed = true;
    for (let i = 0; i < rule.limit + 2; i++) {
      lastAllowed = enforceRateLimit(ns, key).allowed;
    }
    expect(lastAllowed).toBe(false); // superado el límite
    expect(rateLimitBlocks()[ns]).toBeGreaterThanOrEqual(1);
  });

  it("Retry-After proviene de retryAfterMs del limitador", () => {
    const key = `retry-${Math.random()}`;
    const rule = RATE_LIMITS.login;
    let result = enforceRateLimit("login", key);
    for (let i = 0; i < rule.limit; i++) result = enforceRateLimit("login", key);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("modo de despliegue y readiness (bloque 3 §4)", () => {
  it("deriva el modo del entorno", () => {
    expect(deploymentMode({ HELION_DEPLOYMENT_MODE: "production" })).toBe("production");
    expect(deploymentMode({ NODE_ENV: "production" })).toBe("demo"); // sin declarar → demo
    expect(deploymentMode({})).toBe("development");
  });

  it("detecta limitador distribuido por credenciales", () => {
    expect(distributedLimiterConfigured({})).toBe(false);
    expect(distributedLimiterConfigured({ UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" })).toBe(true);
  });

  it("producción distribuida SIN store compartido = CRÍTICO (no pasa en silencio)", () => {
    const r = rateLimiterReadiness({ HELION_DEPLOYMENT_MODE: "production" });
    expect(r.ready).toBe(false);
    expect(r.severity).toBe("critical");
  });

  it("demo de una instancia = aviso, no crítico", () => {
    const r = rateLimiterReadiness({ NODE_ENV: "production" });
    expect(r.severity).toBe("warning");
    expect(r.ready).toBe(true);
  });

  it("con limitador distribuido configurado = ok", () => {
    const r = rateLimiterReadiness({ HELION_DEPLOYMENT_MODE: "production", UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" });
    expect(r.severity).toBe("ok");
    expect(r.ready).toBe(true);
  });
});
