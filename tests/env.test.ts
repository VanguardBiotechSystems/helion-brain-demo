import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/server/env";

const BASE = {
  OPENAI_API_KEY: "sk-test-abcdef123456",
  APP_ACCESS_PASSWORD: "demo-passcode",
};

describe("readEnv", () => {
  it("detecta variables obligatorias ausentes", () => {
    const { env, missing } = readEnv({});
    expect(env).toBeNull();
    expect(missing).toEqual(["OPENAI_API_KEY", "APP_ACCESS_PASSWORD"]);
  });

  it("detecta una sola variable ausente", () => {
    const { env, missing } = readEnv({ OPENAI_API_KEY: "sk-x-12345678" });
    expect(env).toBeNull();
    expect(missing).toEqual(["APP_ACCESS_PASSWORD"]);
  });

  it("trata cadenas vacías o en blanco como ausentes", () => {
    const { missing } = readEnv({ OPENAI_API_KEY: "   ", APP_ACCESS_PASSWORD: "x" });
    expect(missing).toEqual(["OPENAI_API_KEY"]);
  });

  it("aplica valores por defecto", () => {
    const { env } = readEnv(BASE);
    expect(env).not.toBeNull();
    expect(env!.realtimeModel).toBe("gpt-realtime-2.1");
    expect(env!.realtimeVoice).toBe("marin");
    expect(env!.turnDetection).toBe("semantic_vad");
    expect(env!.transcriptionLanguage).toBe("es");
    expect(env!.agentName).toBe("Atlas");
    expect(env!.appName).toBe("Helion");
    expect(env!.openaiBaseUrl).toBe("https://api.openai.com");
  });

  it("respeta los overrides", () => {
    const { env } = readEnv({
      ...BASE,
      OPENAI_REALTIME_MODEL: "gpt-realtime-2.1-mini",
      OPENAI_REALTIME_VOICE: "cedar",
      OPENAI_TURN_DETECTION: "server_vad",
      AGENT_NAME: "JARVIS",
      OPENAI_BASE_URL: "https://proxy.example.com/",
    });
    expect(env!.realtimeModel).toBe("gpt-realtime-2.1-mini");
    expect(env!.realtimeVoice).toBe("cedar");
    expect(env!.turnDetection).toBe("server_vad");
    expect(env!.agentName).toBe("JARVIS");
    expect(env!.openaiBaseUrl).toBe("https://proxy.example.com");
  });

  it("'auto' desactiva el idioma forzado de transcripción", () => {
    const { env } = readEnv({ ...BASE, OPENAI_TRANSCRIPTION_LANGUAGE: "auto" });
    expect(env!.transcriptionLanguage).toBe("");
  });

  it("ignora valores no válidos de turn detection", () => {
    const { env } = readEnv({ ...BASE, OPENAI_TURN_DETECTION: "invented_vad" });
    expect(env!.turnDetection).toBe("semantic_vad");
  });

  it("deriva un secreto de sesión estable si falta SESSION_SECRET", () => {
    const a = readEnv(BASE).env!.sessionSecret;
    const b = readEnv(BASE).env!.sessionSecret;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toContain(BASE.APP_ACCESS_PASSWORD);
  });

  it("usa SESSION_SECRET cuando está definido", () => {
    const { env } = readEnv({ ...BASE, SESSION_SECRET: "super-secreto-de-32-caracteres!!" });
    expect(env!.sessionSecret).toBe("super-secreto-de-32-caracteres!!");
  });
});
