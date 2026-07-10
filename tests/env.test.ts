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
    expect(env!.realtimeVoice).toBe("cedar");
    expect(env!.transcriptionLanguage).toBe("es");
    expect(env!.agentName).toBe("Atlas");
    expect(env!.appName).toBe("Helion");
    expect(env!.openaiBaseUrl).toBe("https://api.openai.com");
    expect(env!.voiceEngine).toBe("openai_realtime");
    expect(env!.elevenLabsModel).toBe("eleven_flash_v2_5");
    expect(env!.elevenLabsOutputFormat).toBe("mp3_44100_128");
  });

  it("perfil de audio por defecto: laptop_demo con server_vad conservador", () => {
    const { env } = readEnv(BASE);
    expect(env!.audio.profile).toBe("laptop_demo");
    expect(env!.audio.turnDetection).toBe("server_vad");
    expect(env!.audio.vadThreshold).toBe(0.6);
    expect(env!.audio.vadSilenceMs).toBe(700);
    expect(env!.audio.noiseReduction).toBe("near_field");
    expect(env!.audio.gate.enabled).toBe(true);
    expect(env!.audio.gate.minSpeechMs).toBe(300);
    expect(env!.audio.gate.autoGainControl).toBe(false);
  });

  it("el perfil robot_room usa far_field y VAD más exigente", () => {
    const { env } = readEnv({ ...BASE, AUDIO_PROFILE: "robot_room" });
    expect(env!.audio.noiseReduction).toBe("far_field");
    expect(env!.audio.vadThreshold).toBe(0.65);
  });

  it("las variables individuales pisan el perfil", () => {
    const { env } = readEnv({
      ...BASE,
      AUDIO_PROFILE: "laptop_demo",
      OPENAI_TURN_DETECTION: "semantic_vad",
      OPENAI_VAD_EAGERNESS: "medium",
      OPENAI_VAD_THRESHOLD: "0.75",
      LOCAL_AUDIO_GATE_ENABLED: "false",
      LOCAL_AUDIO_MIN_SPEECH_MS: "450",
    });
    expect(env!.audio.turnDetection).toBe("semantic_vad");
    expect(env!.audio.vadEagerness).toBe("medium");
    expect(env!.audio.vadThreshold).toBe(0.75);
    expect(env!.audio.gate.enabled).toBe(false);
    expect(env!.audio.gate.minSpeechMs).toBe(450);
  });

  it("valores numéricos inválidos caen al default del perfil", () => {
    const { env } = readEnv({ ...BASE, OPENAI_VAD_THRESHOLD: "no-es-numero" });
    expect(env!.audio.vadThreshold).toBe(0.6);
  });

  it("memoria: defaults razonables", () => {
    const { env } = readEnv(BASE);
    expect(env!.memory.enabled).toBe(true);
    expect(env!.memory.provider).toBe("local");
    expect(env!.memory.embeddingModel).toBe("text-embedding-3-small");
    expect(env!.memory.retrievalTopK).toBe(8);
    expect(env!.memory.minImportance).toBe(0.55);
    expect(env!.memory.autoSave).toBe(true);
    expect(env!.memory.retentionDays).toBeNull();
  });

  it("MEMORY_PROVIDER=postgres exige DATABASE_URL", () => {
    const { env, missing } = readEnv({ ...BASE, MEMORY_PROVIDER: "postgres" });
    expect(env).toBeNull();
    expect(missing).toEqual(["DATABASE_URL"]);
  });

  it("postgres con DATABASE_URL queda configurado", () => {
    const { env } = readEnv({
      ...BASE,
      MEMORY_PROVIDER: "postgres",
      DATABASE_URL: "postgres://user:pass@host/db?sslmode=require",
    });
    expect(env!.memory.provider).toBe("postgres");
  });

  it("con MEMORY_ENABLED=false no se exige DATABASE_URL", () => {
    const { env } = readEnv({ ...BASE, MEMORY_ENABLED: "false", MEMORY_PROVIDER: "postgres" });
    expect(env).not.toBeNull();
    expect(env!.memory.enabled).toBe(false);
  });

  it("VOICE_ENGINE=elevenlabs exige las credenciales de ElevenLabs", () => {
    const { env, missing } = readEnv({ ...BASE, VOICE_ENGINE: "elevenlabs" });
    expect(env).toBeNull();
    expect(missing).toEqual(["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
  });

  it("modo elevenlabs completo queda configurado", () => {
    const { env } = readEnv({
      ...BASE,
      VOICE_ENGINE: "elevenlabs",
      ELEVENLABS_API_KEY: "clave-el-1234",
      ELEVENLABS_VOICE_ID: "voz-es-123",
    });
    expect(env).not.toBeNull();
    expect(env!.voiceEngine).toBe("elevenlabs");
    expect(env!.elevenLabsApiKey).toBe("clave-el-1234");
    expect(env!.elevenLabsVoiceId).toBe("voz-es-123");
  });

  it("valores no válidos de VOICE_ENGINE caen a openai_realtime", () => {
    const { env } = readEnv({ ...BASE, VOICE_ENGINE: "google_tts" });
    expect(env!.voiceEngine).toBe("openai_realtime");
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
    expect(env!.audio.turnDetection).toBe("server_vad");
    expect(env!.agentName).toBe("JARVIS");
    expect(env!.openaiBaseUrl).toBe("https://proxy.example.com");
  });

  it("'auto' desactiva el idioma forzado de transcripción", () => {
    const { env } = readEnv({ ...BASE, OPENAI_TRANSCRIPTION_LANGUAGE: "auto" });
    expect(env!.transcriptionLanguage).toBe("");
  });

  it("ignora valores no válidos de turn detection (cae al perfil)", () => {
    const { env } = readEnv({ ...BASE, OPENAI_TURN_DETECTION: "invented_vad" });
    expect(env!.audio.turnDetection).toBe("server_vad"); // default de laptop_demo
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
