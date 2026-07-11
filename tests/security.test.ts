import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readEnv } from "@/lib/server/env";
import { clientIpFrom } from "@/lib/server/rateLimit";
import { can } from "@/lib/server/authz";
import { resolveProfiles } from "@/lib/server/profiles";

/** Regresiones de seguridad de la auditoría de cierre (bloque 4). */

describe("secreto de sesión no derivado del passcode (P1)", () => {
  it("sin SESSION_SECRET, el secreto NO es sha256('helion-session-v1:'+passcode)", () => {
    const { env } = readEnv({ OPENAI_API_KEY: "sk-x-123456789", APP_ACCESS_PASSWORD: "demo-pass" });
    const derivable = createHash("sha256").update("helion-session-v1:demo-pass").digest("hex");
    expect(env!.sessionSecret).not.toBe(derivable); // no forjable desde el passcode
    expect(env!.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("con SESSION_SECRET explícito, se usa ese", () => {
    const { env } = readEnv({ OPENAI_API_KEY: "sk-x-123456789", APP_ACCESS_PASSWORD: "x", SESSION_SECRET: "un-secreto-largo-y-aleatorio-de-verdad" });
    expect(env!.sessionSecret).toBe("un-secreto-largo-y-aleatorio-de-verdad");
  });
});

describe("clientIpFrom prefiere x-real-ip (XFF es spoofeable) (P2)", () => {
  it("usa x-real-ip aunque X-Forwarded-For traiga una IP falsa a la izquierda", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "x-real-ip": "203.0.113.9" });
    expect(clientIpFrom(h)).toBe("203.0.113.9");
  });
  it("cae a XFF solo si no hay x-real-ip", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIpFrom(new Headers({}))).toBe("unknown");
  });
});

describe("un alias no confirma perfiles con memoria privada (P2)", () => {
  it("robot_creator/team pueden leer privado → NO deben confirmarse por alias (van a 'claimed')", () => {
    const { profiles } = resolveProfiles({});
    const sergio = profiles.find((p) => p.id === "sergio")!; // robot_creator
    // La ruta usa can(profile,'confirmed','read_private_memory') para decidir:
    // si es true, el alias NO basta y queda "claimed".
    expect(can(sergio, "confirmed", "read_private_memory")).toBe(true);
    const investor = profiles.find((p) => p.role === "investor")!;
    expect(can(investor, "confirmed", "read_private_memory")).toBe(false); // sin privado: alias basta
  });
});
