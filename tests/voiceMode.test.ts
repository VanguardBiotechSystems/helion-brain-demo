import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/server/env";
import { resolveVoiceMode } from "@/lib/server/voiceMode";

function envFor(extra: Record<string, string> = {}) {
  const { env } = readEnv({ OPENAI_API_KEY: "sk-x-123456789", APP_ACCESS_PASSWORD: "x", ...extra });
  return env!;
}

describe("política de modos de voz", () => {
  it("openai_realtime → demo_estable (defecto)", () => {
    expect(resolveVoiceMode(envFor()).mode).toBe("demo_estable");
  });
  it("elevenlabs → calidad_voz", () => {
    const env = envFor({ VOICE_ENGINE: "elevenlabs", ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v" });
    expect(resolveVoiceMode(env).mode).toBe("calidad_voz");
  });
  it("futuro_gateway no operativo → fallback explícito y registrado", () => {
    const r = resolveVoiceMode(envFor(), "futuro_gateway");
    expect(r.mode).toBe("demo_estable");
    expect(r.fallback).toBe(true);
  });
  it("modo incoherente con el motor → manda el motor (fallback)", () => {
    const r = resolveVoiceMode(envFor(), "calidad_voz");
    expect(r.mode).toBe("demo_estable");
    expect(r.fallback).toBe(true);
  });
  it("valor inválido → derivado, sin selección silenciosa rara", () => {
    expect(resolveVoiceMode(envFor(), "hibrido_magico").mode).toBe("demo_estable");
  });
});
