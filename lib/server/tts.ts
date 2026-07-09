import type { ErrorCode } from "@/lib/shared/errors";
import type { AppEnv } from "./env";
import { logError, logInfo } from "./log";

/**
 * Abstracción de síntesis de voz (TTS) del lado servidor.
 *
 * - En modo `openai_realtime` NO hay TtsProvider: el propio modelo
 *   speech-to-speech emite el audio por WebRTC (getTtsProvider → null).
 * - En modo `elevenlabs`, ElevenLabsTtsProvider convierte el texto del
 *   cerebro en una voz española nativa. La API key vive solo aquí:
 *   el navegador consume el audio a través de /api/tts.
 */

export interface TtsOptions {
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
}

export type TtsResult =
  | { ok: true; audio: ArrayBuffer; contentType: string }
  | { ok: false; code: ErrorCode; message: string };

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, options?: TtsOptions): Promise<TtsResult>;
}

/**
 * Recorta el texto a sintetizar sin dejar al agente mudo: corta en el último
 * final de frase dentro del límite (o en el último espacio como último
 * recurso). Los subtítulos siempre muestran el texto completo.
 */
export function clampTtsText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const slice = trimmed.slice(0, maxChars);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("…"),
  );
  if (sentenceEnd > maxChars * 0.4) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

function contentTypeFor(outputFormat: string): string {
  if (outputFormat.startsWith("mp3")) return "audio/mpeg";
  if (outputFormat.startsWith("opus")) return "audio/ogg";
  return "application/octet-stream";
}

/** Los modelos v2.5 (flash/turbo) aceptan language_code para forzar idioma. */
function supportsLanguageCode(modelId: string): boolean {
  return /flash|turbo/i.test(modelId);
}

function mapElevenLabsFailure(status: number): { ok: false; code: ErrorCode; message: string } {
  if (status === 401) {
    return {
      ok: false,
      code: "invalid_api_key",
      message: "La clave de ElevenLabs no es válida (o el voice ID no está disponible con esa clave).",
    };
  }
  if (status === 403) {
    return {
      ok: false,
      code: "invalid_api_key",
      message:
        "La clave de ElevenLabs no tiene permisos para esta voz. Las voces de la Voice Library requieren un plan de pago para usarse por API.",
    };
  }
  if (status === 402) {
    return {
      ok: false,
      code: "quota_exceeded",
      message: "La cuenta de ElevenLabs no tiene créditos suficientes.",
    };
  }
  if (status === 404 || status === 400) {
    return {
      ok: false,
      code: "tts_failed",
      message: "La voz configurada no existe: revisa ELEVENLABS_VOICE_ID.",
    };
  }
  if (status === 422) {
    return {
      ok: false,
      code: "tts_failed",
      message: "ElevenLabs rechazó el texto o el formato solicitado.",
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      message: "ElevenLabs está limitando las peticiones. Espera unos segundos.",
    };
  }
  return {
    ok: false,
    code: "tts_failed",
    message: "ElevenLabs devolvió un error inesperado al generar la voz.",
  };
}

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs";

  constructor(
    private readonly apiKey: string,
    private readonly voiceId: string,
    private readonly modelId: string,
    private readonly outputFormat: string,
    private readonly baseUrl: string = "https://api.elevenlabs.io",
  ) {}

  async synthesize(text: string, options?: TtsOptions): Promise<TtsResult> {
    const voiceId = options?.voiceId ?? this.voiceId;
    const modelId = options?.modelId ?? this.modelId;
    const outputFormat = options?.outputFormat ?? this.outputFormat;

    const body: Record<string, unknown> = { text, model_id: modelId };
    if (supportsLanguageCode(modelId)) {
      body.language_code = "es";
    }

    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify(body),
          cache: "no-store",
        },
      );
    } catch (error) {
      logError("tts", "No se pudo contactar con ElevenLabs", error);
      return { ok: false, code: "tts_failed", message: "No se pudo contactar con ElevenLabs." };
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      logError("tts", `ElevenLabs fallo status=${response.status} body=${bodyText.slice(0, 400)}`);
      return mapElevenLabsFailure(response.status);
    }

    const audio = await response.arrayBuffer();
    if (audio.byteLength === 0) {
      logError("tts", "ElevenLabs devolvió audio vacío");
      return { ok: false, code: "tts_failed", message: "ElevenLabs devolvió un audio vacío." };
    }

    logInfo("tts", `Audio generado (voz=${voiceId}, modelo=${modelId}, ${audio.byteLength} bytes)`);
    return { ok: true, audio, contentType: contentTypeFor(outputFormat) };
  }
}

/**
 * Devuelve el proveedor TTS si hay credenciales de ElevenLabs configuradas
 * (aunque el motor activo sea openai_realtime, para poder probar la voz
 * desde el panel de diagnóstico antes de cambiar de motor).
 */
export function getTtsProvider(env: AppEnv): TtsProvider | null {
  if (!env.elevenLabsApiKey || !env.elevenLabsVoiceId) return null;
  return new ElevenLabsTtsProvider(
    env.elevenLabsApiKey,
    env.elevenLabsVoiceId,
    env.elevenLabsModel,
    env.elevenLabsOutputFormat,
  );
}
