import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsTtsProvider } from "@/lib/server/tts";

function audioResponse(bytes = 3): Response {
  return new Response(new Uint8Array(bytes).fill(1), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ detail: { status: "error" } }), { status });
}

function provider(model = "eleven_flash_v2_5"): ElevenLabsTtsProvider {
  return new ElevenLabsTtsProvider("clave-el-secreta", "voz-es-123", model, "mp3_44100_128");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ElevenLabsTtsProvider", () => {
  it("llama al endpoint correcto con la cabecera xi-api-key y devuelve audio", async () => {
    const fetchMock = vi.fn(async () => audioResponse(5));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider().synthesize("Hola, esto es una prueba.");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audio.byteLength).toBe(5);
      expect(result.contentType).toBe("audio/mpeg");
    }

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voz-es-123?output_format=mp3_44100_128",
    );
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("clave-el-secreta");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.text).toBe("Hola, esto es una prueba.");
    expect(body.model_id).toBe("eleven_flash_v2_5");
  });

  it("fuerza español (language_code) en modelos flash/turbo", async () => {
    const fetchMock = vi.fn(async () => audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    await provider("eleven_flash_v2_5").synthesize("Hola");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.language_code).toBe("es");
  });

  it("no envía language_code en modelos que no lo soportan", async () => {
    const fetchMock = vi.fn(async () => audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    await provider("eleven_multilingual_v2").synthesize("Hola");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.language_code).toBeUndefined();
  });

  it("mapea 401 a invalid_api_key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(401)));
    const result = await provider().synthesize("Hola");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_api_key");
  });

  it("mapea 404 a tts_failed con pista sobre el voice id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(404)));
    const result = await provider().synthesize("Hola");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("tts_failed");
      expect(result.message).toContain("ELEVENLABS_VOICE_ID");
    }
  });

  it("mapea 402 (sin créditos) a quota_exceeded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(402)));
    const result = await provider().synthesize("Hola");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("quota_exceeded");
  });

  it("mapea 429 a rate_limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(429)));
    const result = await provider().synthesize("Hola");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("rate_limited");
  });

  it("un fallo de red devuelve tts_failed sin lanzar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await provider().synthesize("Hola");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("tts_failed");
  });

  it("un audio vacío se trata como error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => audioResponse(0)));
    const result = await provider().synthesize("Hola");
    expect(result.ok).toBe(false);
  });
});
