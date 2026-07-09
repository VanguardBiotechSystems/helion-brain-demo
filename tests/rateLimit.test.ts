import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter, clientIpFrom } from "@/lib/server/rateLimit";

describe("SlidingWindowLimiter", () => {
  it("permite peticiones por debajo del límite", () => {
    const limiter = new SlidingWindowLimiter(3, 1000);
    expect(limiter.check("ip", 0).allowed).toBe(true);
    expect(limiter.check("ip", 10).allowed).toBe(true);
    expect(limiter.check("ip", 20).allowed).toBe(true);
  });

  it("bloquea al superar el límite e informa el tiempo de espera", () => {
    const limiter = new SlidingWindowLimiter(2, 1000);
    limiter.check("ip", 0);
    limiter.check("ip", 100);
    const result = limiter.check("ip", 200);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(800);
  });

  it("la ventana se desliza: las peticiones antiguas dejan de contar", () => {
    const limiter = new SlidingWindowLimiter(2, 1000);
    limiter.check("ip", 0);
    limiter.check("ip", 100);
    expect(limiter.check("ip", 1101).allowed).toBe(true);
  });

  it("las claves son independientes", () => {
    const limiter = new SlidingWindowLimiter(1, 1000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(false);
  });
});

describe("clientIpFrom", () => {
  it("usa el primer valor de x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientIpFrom(headers)).toBe("203.0.113.9");
  });

  it("cae a x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.4" });
    expect(clientIpFrom(headers)).toBe("198.51.100.4");
  });

  it("devuelve 'unknown' sin cabeceras", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});
