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
