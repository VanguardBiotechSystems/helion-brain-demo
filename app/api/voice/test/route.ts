import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getProfileById } from "@/lib/server/profiles";
import { getTtsProvider } from "@/lib/server/tts";
import { clientIpFrom, enforceRateLimit } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Prueba rápida de la voz española externa: devuelve el audio de una frase
 * fija en castellano. Funciona aunque el motor activo sea openai_realtime,
 * para poder validar la voz de ElevenLabs ANTES de cambiar VOICE_ENGINE.
 * Con la cookie de acceso puesta, también sirve abrirla en el navegador.
 */
export async function GET(request: NextRequest) {
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

  const ip = clientIpFrom(request.headers);
  const { allowed, retryAfterMs } = enforceRateLimit("voice-test", `ip:${ip}`);
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiadas pruebas de voz en poco tiempo." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const provider = getTtsProvider(env);
  if (!provider) {
    return NextResponse.json(
      {
        error: {
          code: "config_missing",
          message:
            "Configura ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID en las variables de entorno para probar la voz.",
        },
      },
      { status: 503 },
    );
  }

  const phrase =
    `Hola, soy ${env.appName}. Esta es una prueba de voz en español de España. ` +
    "Estoy listo para funcionar como cerebro conversacional del robot.";

  const result = await provider.synthesize(phrase);
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
