import { describe, expect, it } from "vitest";
import { readEnv, type AppEnv } from "@/lib/server/env";
import { buildRealtimeSessionConfig } from "@/lib/server/realtime";

function envFor(extra: Record<string, string> = {}): AppEnv {
  const { env } = readEnv({
    OPENAI_API_KEY: "sk-test-12345678",
    APP_ACCESS_PASSWORD: "demo",
    ...extra,
  });
  if (!env) throw new Error("env de prueba inválido");
  return env;
}

describe("buildRealtimeSessionConfig", () => {
  it("modo openai_realtime: salida de audio con la voz configurada", () => {
    const config = buildRealtimeSessionConfig(envFor());
    expect(config.output_modalities).toEqual(["audio"]);
    const audio = config.audio as { output?: { voice?: string }; input?: unknown };
    expect(audio.output?.voice).toBe("cedar");
    expect(audio.input).toBeDefined();
  });

  it("modo elevenlabs: salida de texto, sin voz OpenAI, con reglas TTS", () => {
    const config = buildRealtimeSessionConfig(
      envFor({
        VOICE_ENGINE: "elevenlabs",
        ELEVENLABS_API_KEY: "clave",
        ELEVENLABS_VOICE_ID: "voz",
      }),
    );
    expect(config.output_modalities).toEqual(["text"]);
    const audio = config.audio as { output?: unknown; input?: { turn_detection?: unknown } };
    expect(audio.output).toBeUndefined();
    // Los oídos no cambian: VAD y transcripción siguen activos.
    expect(audio.input?.turn_detection).toBeDefined();
    expect(String(config.instructions)).toContain("voz externa");
  });

  it("las instrucciones exigen castellano de España en ambos modos", () => {
    for (const config of [
      buildRealtimeSessionConfig(envFor()),
      buildRealtimeSessionConfig(
        envFor({ VOICE_ENGINE: "elevenlabs", ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v" }),
      ),
    ]) {
      const instructions = String(config.instructions);
      expect(instructions).toContain("español de España");
      expect(instructions).toContain("castellano");
    }
  });

  it("activa razonamiento bajo solo en modelos realtime 2.x", () => {
    expect(buildRealtimeSessionConfig(envFor()).reasoning).toEqual({ effort: "low" });
    expect(
      buildRealtimeSessionConfig(envFor({ OPENAI_REALTIME_MODEL: "gpt-realtime" })).reasoning,
    ).toBeUndefined();
  });
});
