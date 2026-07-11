import { NextResponse } from "next/server";
import { readEnv } from "@/lib/server/env";
import { rateLimiterReadiness } from "@/lib/server/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Salud básica de la aplicación. Público y sin secretos:
 * solo booleanos y severidades, nunca valores. Incluye el readiness del
 * rate limiting (crítico en producción distribuida sin store compartido)
 * para que las sondas de despliegue lo detecten.
 */
export async function GET() {
  const { missing } = readEnv();
  const rl = rateLimiterReadiness();
  // Config incompleta o rate limiter no listo degradan el estado.
  const status = missing.length > 0 || !rl.ready ? "degraded" : "ok";
  return NextResponse.json({
    status,
    app: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Helion",
    time: new Date().toISOString(),
    checks: {
      openaiKeyConfigured: !missing.includes("OPENAI_API_KEY"),
      accessPasswordConfigured: !missing.includes("APP_ACCESS_PASSWORD"),
      sessionSecretConfigured: Boolean(process.env.SESSION_SECRET?.trim()),
      rateLimiter: { mode: rl.mode, severity: rl.severity, ready: rl.ready },
    },
  });
}
