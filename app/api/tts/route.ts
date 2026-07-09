import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getTtsProvider } from "@/lib/server/tts";
import { clientIpFrom, getLimiter } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

const MAX_TTS_CHARS = 1500;

/**
 * Síntesis de voz del lado servidor (ElevenLabs).
 * La API key de ElevenLabs nunca sale de aquí: el cliente envía texto
 * y recibe audio. Requiere cookie de acceso y aplica rate limiting.
 */
export async function POST(request: NextRequest) {
  const { env } = readEnv();
  if (!env) {
    return NextResponse.json(
      { error: { code: "config_missing", message: "El servidor no está configurado todavía." } },
      { status: 503 },
    );
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!verifyAccessToken(env.sessionSecret, token)) {
    return NextResponse.json(
      { error: { code: "not_authenticated", message: "La sesión de acceso ha caducado." } },
      { status: 401 },
    );
  }

  const ip = clientIpFrom(request.headers);
  const { allowed, retryAfterMs } = getLimiter("tts", 60, 10 * 60 * 1000).check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiadas peticiones de voz en poco tiempo." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const provider = getTtsProvider(env);
  if (!provider) {
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
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TTS_CHARS) {
    return NextResponse.json(
      { error: { code: "unknown", message: "El texto a sintetizar no es válido." } },
      { status: 400 },
    );
  }

  const result = await provider.synthesize(text);
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 502 });
  }

  return new NextResponse(result.audio, {
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
    },
  });
}
