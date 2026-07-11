import { logError, logInfo } from "../log";
import { scrub, scrubString } from "./scrub";

/**
 * Observabilidad de errores (bloque 3, §1). Fachada agnóstica de proveedor:
 * - Siempre registra en el logger de servidor (ya redactado).
 * - Si hay SENTRY_DSN (o compatible), reenvía el evento YA SANEADO mediante
 *   import dinámico opcional; la ausencia de DSN o del SDK nunca rompe el
 *   arranque ni una petición.
 *
 * Nunca se pasan al proveedor nombres de personas ni identificadores
 * persistentes: solo códigos, categorías, modo, proveedor, versión,
 * navegador, fase de sesión y un id de correlación de corta duración.
 */

export type ObservabilityCategory =
  | "session_create"
  | "openai"
  | "elevenlabs"
  | "memory"
  | "cron"
  | "identity"
  | "tool"
  | "reconnect"
  | "orb"
  | "route"
  | "telemetry"
  | "client"
  | "e2e"
  | "unknown";

export interface ObservabilityContext {
  category: ObservabilityCategory;
  /** Código de error estable (taxonomía), no un mensaje libre. */
  code?: string;
  provider?: "openai" | "elevenlabs" | "postgres" | "none";
  /** Fase de la sesión (connecting, calibrating, listening, speaking…). */
  phase?: string;
  voiceMode?: string;
  appVersion?: string;
  /** Navegador general (chromium/webkit/firefox), no user-agent completo. */
  browser?: string;
  /** Id de correlación pseudónimo y efímero (no rastreable a una persona). */
  correlationId?: string;
  /** Extra estructurado; se sanea antes de salir. */
  extra?: Record<string, unknown>;
}

interface SentryLike {
  captureException?: (e: unknown, hint?: unknown) => void;
  captureMessage?: (m: string, hint?: unknown) => void;
}

const state = globalThis as unknown as {
  __helionSentry?: SentryLike | null;
  __helionObsInit?: boolean;
  __helionObsCounts?: Record<string, number>;
};

function dsn(): string {
  return (process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim();
}

/** ¿Está la observabilidad externa configurada? (No revela el DSN.) */
export function observabilityEnabled(): boolean {
  return dsn().length > 0;
}

/**
 * Carga perezosa y opcional del SDK. Si el paquete no está instalado o el DSN
 * falta, se degrada a solo-logging sin lanzar. Se hace una sola vez.
 */
async function getSink(): Promise<SentryLike | null> {
  if (state.__helionObsInit) return state.__helionSentry ?? null;
  state.__helionObsInit = true;
  if (!dsn()) {
    state.__helionSentry = null;
    return null;
  }
  try {
    // Import dinámico por nombre indirecto: si @sentry/node no está instalado,
    // el bundler no lo exige y aquí se captura el fallo de resolución.
    const moduleName = "@sentry/node";
    const sentry = (await import(/* @vite-ignore */ moduleName).catch(() => null)) as
      | (SentryLike & { init?: (o: Record<string, unknown>) => void })
      | null;
    if (!sentry?.init) {
      logInfo("observability", "SENTRY_DSN presente pero @sentry/node no instalado: solo-logging");
      state.__helionSentry = null;
      return null;
    }
    sentry.init({ dsn: dsn(), tracesSampleRate: 0, environment: process.env.NODE_ENV ?? "development" });
    state.__helionSentry = sentry;
    logInfo("observability", "Observabilidad externa inicializada");
    return sentry;
  } catch {
    state.__helionSentry = null;
    return null;
  }
}

function bump(category: string): void {
  const counts = (state.__helionObsCounts ??= {});
  counts[category] = (counts[category] ?? 0) + 1;
}

/** Recuentos agregados de eventos por categoría (para el panel operativo). */
export function observabilityCounts(): Record<string, number> {
  return { ...(state.__helionObsCounts ?? {}) };
}

function buildTags(ctx: ObservabilityContext): Record<string, string> {
  const tags: Record<string, string> = { category: ctx.category };
  if (ctx.code) tags.code = ctx.code;
  if (ctx.provider) tags.provider = ctx.provider;
  if (ctx.phase) tags.phase = ctx.phase;
  if (ctx.voiceMode) tags.voice_mode = ctx.voiceMode;
  if (ctx.appVersion) tags.app_version = ctx.appVersion;
  if (ctx.browser) tags.browser = ctx.browser;
  if (ctx.correlationId) tags.correlation_id = ctx.correlationId;
  return tags;
}

/** Captura un error (servidor o reenviado del cliente) ya redactado. */
export function captureError(error: unknown, ctx: ObservabilityContext): void {
  bump(ctx.category);
  const scrubbedExtra = ctx.extra ? scrub(ctx.extra) : undefined;
  const message = error instanceof Error ? error.message : String(error);
  logError(`obs:${ctx.category}`, `${ctx.code ?? "error"} ${scrubString(message)}`);
  // Reenvío best-effort; nunca bloquea ni lanza.
  void getSink()
    .then((sink) => {
      sink?.captureException?.(scrub(error), { tags: buildTags(ctx), extra: scrubbedExtra });
    })
    .catch(() => {});
}

/** Captura un mensaje/observación (no necesariamente error). */
export function captureMessage(message: string, ctx: ObservabilityContext): void {
  bump(ctx.category);
  logInfo(`obs:${ctx.category}`, `${ctx.code ?? "msg"} ${scrubString(message)}`);
  void getSink()
    .then((sink) => {
      sink?.captureMessage?.(scrubString(message), { tags: buildTags(ctx), extra: ctx.extra ? scrub(ctx.extra) : undefined });
    })
    .catch(() => {});
}
