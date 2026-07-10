import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getProfileById } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

/**
 * Configuración no sensible para el panel de diagnóstico.
 * Requiere autenticación: no expone nada a visitantes anónimos.
 */
export async function GET(request: NextRequest) {
  const { env, missing } = readEnv();
  if (!env) {
    return NextResponse.json(
      { error: { code: "config_missing", message: "El servidor no está configurado todavía.", missing } },
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

  return NextResponse.json({
    profile: { id: profile.id, displayName: profile.displayName, role: profile.role, canViewDebug: profile.canViewDebug },
    appName: env.appName,
    agentName: env.agentName,
    model: env.realtimeModel,
    voice: env.voiceEngine === "elevenlabs" ? env.elevenLabsVoiceId : env.realtimeVoice,
    turnDetection: env.audio.turnDetection,
    transcriptionModel: env.transcriptionModel,
    textModel: env.textModel,
    voiceEngine: env.voiceEngine,
    elevenLabsConfigured: Boolean(env.elevenLabsApiKey && env.elevenLabsVoiceId),
    elevenLabsVoiceId: env.elevenLabsVoiceId || null,
    elevenLabsModel: env.elevenLabsModel,
    audio: {
      profile: env.audio.profile,
      turnDetection: env.audio.turnDetection,
      vadThreshold: env.audio.vadThreshold,
      vadSilenceMs: env.audio.vadSilenceMs,
      vadPrefixPaddingMs: env.audio.vadPrefixPaddingMs,
      vadEagerness: env.audio.vadEagerness,
      noiseReduction: env.audio.noiseReduction,
      gateEnabled: env.audio.gate.enabled,
    },
    memory: {
      enabled: env.memory.enabled,
      provider: env.memory.provider,
      autoSave: env.memory.autoSave,
      extractionModel: env.memory.extractionModel,
      embeddingModel: env.memory.embeddingModel,
    },
  });
}
