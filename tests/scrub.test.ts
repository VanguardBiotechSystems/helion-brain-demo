import { describe, expect, it } from "vitest";
import { scrub, scrubString, scrubUrl, scrubHeaders, REDACTED } from "@/lib/server/observability/scrub";

describe("scrubber de observabilidad (bloque 3 §1/§13)", () => {
  it("redacta claves por nombre en objetos anidados", () => {
    const input = {
      code: "openai_error",
      user: { pin: "1234", email: "juanma@example.com", displayName: "Juanma" },
      session: { clientSecret: "rt_abc123", nested: { authorization: "Bearer xyz" } },
    };
    const out = scrub(input) as Record<string, Record<string, Record<string, string>>>;
    expect(out.code).toBe("openai_error"); // benigno se conserva
    expect(out.user.pin).toBe(REDACTED);
    expect(out.user.email).toBe(REDACTED);
    expect(out.user.displayName).toBe(REDACTED);
    expect(out.session.clientSecret).toBe(REDACTED);
    expect(out.session.nested.authorization).toBe(REDACTED);
  });

  it("redacta secretos incrustados en valores aunque la clave sea benigna", () => {
    const out = scrub({ note: "falló con sk-ABC123DEF456 en la llamada" }) as Record<string, string>;
    expect(out.note).not.toContain("sk-ABC123DEF456");
    expect(out.note).toContain(REDACTED);
  });

  it("redacta emails y JWT sueltos en texto", () => {
    expect(scrubString("contacto: ana@correo.es")).toContain(REDACTED);
    expect(scrubString("token eyJhbGciOi.eyJzdWIi.SflKxwRJ")).toContain(REDACTED);
  });

  it("sanea excepciones conservando nombre y mensaje redactado", () => {
    const err = new Error("fallo con Bearer secret-token-123");
    const out = scrub(err) as { name: string; message: string; stack?: string };
    expect(out.name).toBe("Error");
    expect(out.message).not.toContain("secret-token-123");
    expect(out.message).toContain(REDACTED);
  });

  it("limpia URLs: sin query ni credenciales", () => {
    expect(scrubUrl("https://api.openai.com/v1/x?token=abc&k=1")).toBe("https://api.openai.com/v1/x");
    expect(scrubUrl("https://user:pass@host.com/p")).toBe("https://host.com/p");
    // La query, que puede llevar secretos, desaparece por completo.
    expect(scrubUrl("https://h/x?apikey=sk-123")).not.toContain("sk-123");
  });

  it("redacta cabeceras de autorización y cookies", () => {
    const headers = new Headers({ authorization: "Bearer abc", cookie: "hb_access=xyz", "x-request-id": "r1" });
    const out = scrubHeaders(headers);
    expect(out.authorization).toBe(REDACTED);
    expect(out.cookie).toBe(REDACTED);
    expect(out["x-request-id"]).toBe("r1");
  });

  it("redacta connection strings de base de datos", () => {
    const out = scrub({ msg: "postgres://u:p@host:5432/db falló" }) as Record<string, string>;
    expect(out.msg).not.toContain("host:5432");
    expect(out.msg).toContain(REDACTED);
  });

  it("no filtra transcripciones, prompts ni recuerdos por clave", () => {
    const out = scrub({ transcript: "hola qué tal", prompt: "eres helion…", memory: "dato privado" }) as Record<string, string>;
    expect(out.transcript).toBe(REDACTED);
    expect(out.prompt).toBe(REDACTED);
    expect(out.memory).toBe(REDACTED);
  });

  it("acota profundidad y tamaño (no explota con estructuras enormes)", () => {
    let deep: Record<string, unknown> = { v: "x" };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    const out = JSON.stringify(scrub(deep));
    expect(out).toContain("profundidad máxima");
    const big = "a".repeat(5000);
    expect((scrubString(big)).length).toBeLessThan(600);
  });
});

describe("scrubber — endurecimiento auditoría bloque 4", () => {
  it("redacta claves de contenido/PII habituales (name, message, text, note)", () => {
    const out = scrub({ name: "Juanma López", message: "hola qué tal hoy", text: "algo privado", note: "recordatorio" }) as Record<string, string>;
    expect(out.name).toBe(REDACTED);
    expect(out.message).toBe(REDACTED);
    expect(out.text).toBe(REDACTED);
    expect(out.note).toBe(REDACTED);
  });

  it("redacta SSN, AWS/Google keys e IPv4 en valores sueltos", () => {
    expect(scrubString("ssn 123-45-6789")).toContain(REDACTED);
    expect(scrubString("key AKIAIOSFODNN7EXAMPLE")).toContain(REDACTED);
    expect(scrubString("ip 192.168.1.42 conectó")).toContain(REDACTED);
  });

  it("scrubUrl elimina también el fragmento (#token) y sanea el resto", () => {
    const out = scrubUrl("https://h/callback#access_token=abc123&x=1");
    expect(out).not.toContain("access_token");
    expect(out).not.toContain("abc123");
  });
})
