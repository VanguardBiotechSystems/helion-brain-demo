import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";
import { buildTtsRequestBody, mapElevenLabsFailure } from "@/lib/server/tts";

export const dynamic = "force-dynamic";

const MAX_CHUNK_CHARS = 600;

/**
 * Proxy de TTS en STREAMING: reenvía el audio chunked de ElevenLabs al
 * navegador según llega, sin esperar la síntesis completa. Es el camino
 * rápido del modo elevenlabs: un fragmento corto de texto entra, los
 * primeros frames MP3 salen en cuanto existen. La clave xi nunca sale
 * del servidor.
 */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "tts", limit: 240, windowMs: 600000 } });
  if (!guard.ok) return guard.response;
  const { env } = guard;

  if (!env.elevenLabsApiKey || !env.elevenLabsVoiceId) {
    return NextResponse.json(
      {
        error: {
          code: "config_missing",
          message: "Configura ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID para usar la voz externa.",
        },
      },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_CHUNK_CHARS) : "";
  if (!text) {
    return NextResponse.json(
      { error: { code: "tts_failed", message: "El texto a sintetizar está vacío." } },
      { status: 400 },
    );
  }

  const tuning = env.elevenLabsTuning;
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.elevenLabsVoiceId)}/stream` +
    `?output_format=${encodeURIComponent(env.elevenLabsOutputFormat)}&optimize_streaming_latency=3`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": env.elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(
        buildTtsRequestBody(text, env.elevenLabsModel, {
          speed: tuning.speed,
          stability: tuning.stability,
          similarityBoost: tuning.similarityBoost,
          style: tuning.style,
          useSpeakerBoost: tuning.useSpeakerBoost,
        }),
      ),
      cache: "no-store",
      // Si el cliente cancela (barge-in), se corta también la síntesis.
      signal: request.signal,
    });
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") {
      return new NextResponse(null, { status: 499 });
    }
    logError("tts", "No se pudo contactar con ElevenLabs (stream)", error);
    return NextResponse.json(
      { error: { code: "tts_failed", message: "No se pudo contactar con ElevenLabs." } },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const bodyText = await upstream.text().catch(() => "");
    logError("tts", `ElevenLabs stream fallo status=${upstream.status} body=${bodyText.slice(0, 300)}`);
    const failure = mapElevenLabsFailure(upstream.status);
    return NextResponse.json({ error: { code: failure.code, message: failure.message } }, { status: 502 });
  }

  // Passthrough del stream: el navegador recibe los frames según llegan.
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
