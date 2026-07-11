import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getProfileById } from "@/lib/server/profiles";
import { clampTtsText, getTtsProvider } from "@/lib/server/tts";
import { clientIpFrom, enforceRateLimit } from "@/lib/server/rateLimit";

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
  const session = verifyAccessToken(env.sessionSecret, token);
  const profile = session ? getProfileById(env.profiles, session.profileId, env.identity.allowDynamicProfiles) : null;
  if (!session || !profile) {
    return NextResponse.json(
      { error: { code: "not_authenticated", message: "La sesión de acceso ha caducado." } },
      { status: 401 },
    );
  }

  // Clave por sesión de acceso (no por IP): varias personas tras el mismo
  // NAT no se roban la cuota, y una conversación fluida (una síntesis por
  // turno) cabe de sobra en el límite.
  const limiterKey = token ? `tk:${token.slice(-24)}` : `ip:${clientIpFrom(request.headers)}`;
  const { allowed, retryAfterMs } = enforceRateLimit("tts", limiterKey);
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
  const rawText = typeof body?.text === "string" ? body.text.trim() : "";
  if (!rawText) {
    return NextResponse.json(
      { error: { code: "tts_failed", message: "El texto a sintetizar está vacío." } },
      { status: 400 },
    );
  }

  // Las respuestas largas se recortan en frase: mejor una voz que termina
  // antes que un robot mudo con un banner de error.
  const text = clampTtsText(rawText, MAX_TTS_CHARS);

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
