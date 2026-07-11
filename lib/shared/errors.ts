/**
 * Taxonomía de errores de la aplicación.
 * Cada código tiene un mensaje humano (para UI) y una pista accionable.
 * El detalle técnico nunca viaja al cliente: se registra solo en servidor.
 */

export type ErrorCode =
  | "mic_permission"
  | "mic_unavailable"
  | "browser_unsupported"
  | "audio_playback"
  | "not_authenticated"
  | "passcode_incorrect"
  | "rate_limited"
  | "config_missing"
  | "session_create_failed"
  | "invalid_api_key"
  | "model_unavailable"
  | "quota_exceeded"
  | "network_offline"
  | "webrtc_failed"
  | "openai_error"
  | "tts_failed"
  | "mic_lost"
  | "memory_unavailable"
  | "identity_unconfirmed"
  | "usage_limited"
  | "provider_openai_down"
  | "provider_elevenlabs_down"
  | "streaming_fallback"
  | "text_fallback"
  | "unknown";

export interface AppError {
  code: ErrorCode;
  message: string;
  hint?: string;
}

export const ERROR_COPY: Record<ErrorCode, { message: string; hint?: string }> = {
  mic_permission: {
    message: "No hay permiso para usar el micrófono.",
    hint: "Pulsa el icono del candado en la barra del navegador, permite el micrófono y vuelve a conectar.",
  },
  mic_unavailable: {
    message: "No se ha detectado ningún micrófono.",
    hint: "Conecta un micrófono o auriculares con micro y vuelve a intentarlo. Mientras tanto puedes usar el modo texto.",
  },
  browser_unsupported: {
    message: "Este navegador no soporta audio en tiempo real (WebRTC).",
    hint: "Usa una versión reciente de Chrome, Edge, Safari o Firefox.",
  },
  audio_playback: {
    message: "El navegador ha bloqueado la reproducción de audio.",
    hint: "Pulsa «Activar audio» para desbloquear la voz del agente.",
  },
  not_authenticated: {
    message: "La sesión de acceso ha caducado.",
    hint: "Recarga la página e introduce de nuevo el passcode.",
  },
  passcode_incorrect: {
    message: "Passcode incorrecto.",
    hint: "Revisa el código de acceso que te han compartido.",
  },
  rate_limited: {
    message: "Demasiadas peticiones en poco tiempo.",
    hint: "Espera unos segundos y vuelve a intentarlo.",
  },
  config_missing: {
    message: "El servidor no está configurado todavía.",
    hint: "Faltan variables de entorno. Revisa la configuración del despliegue.",
  },
  session_create_failed: {
    message: "No se pudo iniciar la sesión de voz.",
    hint: "Vuelve a intentarlo. Si persiste, revisa el panel de diagnóstico.",
  },
  invalid_api_key: {
    message: "El servidor no puede autenticarse con OpenAI.",
    hint: "La clave de API configurada no es válida o no tiene permisos.",
  },
  model_unavailable: {
    message: "El modelo de voz configurado no está disponible en esta cuenta.",
    hint: "Cambia OPENAI_REALTIME_MODEL a un modelo disponible (p. ej. gpt-realtime-2.1).",
  },
  quota_exceeded: {
    message: "La cuenta de OpenAI no tiene crédito o ha superado su cuota.",
    hint: "Revisa la facturación de la cuenta de OpenAI.",
  },
  network_offline: {
    message: "Sin conexión a internet.",
    hint: "El agente se reconectará automáticamente cuando vuelva la red.",
  },
  webrtc_failed: {
    message: "La conexión de audio en tiempo real ha fallado.",
    hint: "Puede ser la red (firewall/VPN). Prueba a reconectar o usa el modo texto.",
  },
  openai_error: {
    message: "OpenAI ha devuelto un error inesperado.",
    hint: "Vuelve a intentarlo en unos segundos.",
  },
  tts_failed: {
    message: "No se pudo generar la voz española externa.",
    hint: "Revisa ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID y la cuota de tu cuenta de ElevenLabs.",
  },
  // Fallbacks honestos (§8): mensajes breves en el tono de Helion, sin jerga
  // técnica ni frases falsas de "todo funciona". La consola privada muestra el
  // código y la causa; el usuario solo ve esto.
  mic_lost: {
    message: "Me he quedado sin oído: el micrófono ha dejado de estar disponible.",
    hint: "Revisa el micrófono o los permisos y vuelve a conectar. Mientras, puedes escribirme.",
  },
  memory_unavailable: {
    message: "Ahora mismo no llego a mi memoria, así que hablo sin recordar lo anterior.",
    hint: "Puedes seguir hablando; la memoria volverá cuando el almacén responda.",
  },
  identity_unconfirmed: {
    message: "Antes de abrir nada tuyo necesito confirmar quién eres.",
    hint: "Dime tu nombre; si eres el owner, tendré que pedirte el PIN.",
  },
  usage_limited: {
    message: "Por hoy toca parar aquí: se ha alcanzado el límite de uso.",
    hint: "Vuelve a intentarlo más tarde. El owner puede ampliar el límite si hace falta.",
  },
  provider_openai_down: {
    message: "Ahora mismo no puedo pensar con normalidad. Reinténtalo en un momento.",
    hint: "El servicio de voz/razonamiento no responde. Puedes usar el modo texto mientras tanto.",
  },
  provider_elevenlabs_down: {
    message: "Te sigo entendiendo, pero mi voz de calidad no está disponible ahora.",
    hint: "Sigo respondiendo con la voz estable; la voz de calidad volverá cuando el proveedor responda.",
  },
  streaming_fallback: {
    message: "Voy un pelín más lento: he pasado a generar la voz de una vez.",
    hint: "El streaming de audio no está disponible; la respuesta llega completa en lugar de por trozos.",
  },
  text_fallback: {
    message: "No puedo hablar ahora mismo, pero te respondo por escrito.",
    hint: "El audio en tiempo real no está disponible; la conversación sigue por texto.",
  },
  unknown: {
    message: "Ha ocurrido un error inesperado.",
    hint: "Reinicia la sesión. Si persiste, revisa el panel de diagnóstico.",
  },
};

export function toAppError(code: ErrorCode, message?: string, hint?: string): AppError {
  const copy = ERROR_COPY[code] ?? ERROR_COPY.unknown;
  return {
    code,
    message: message ?? copy.message,
    hint: hint ?? copy.hint,
  };
}
