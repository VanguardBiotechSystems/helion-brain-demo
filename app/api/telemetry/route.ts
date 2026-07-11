import { NextRequest, NextResponse } from "next/server";
import { clientIpFrom, enforceRateLimit } from "@/lib/server/rateLimit";
import { TELEMETRY_MAX_BYTES, validateTelemetry } from "@/lib/shared/telemetry";
import { ingestTelemetry, recordTelemetryRejected } from "@/lib/server/telemetryStore";
import { captureMessage } from "@/lib/server/observability";

export const dynamic = "force-dynamic";

/**
 * POST /api/telemetry — ingesta de telemetría AGREGADA (bloque 3, §2).
 * Público (el cliente la envía al terminar la sesión) pero acotado: rate
 * limit por IP, tamaño máximo, esquema versionado estricto (rechaza campos
 * desconocidos), idempotencia por correlationId. NUNCA acepta contenido:
 * el validador descarta cualquier campo fuera del esquema.
 */
export async function POST(request: NextRequest) {
  const ip = clientIpFrom(request.headers);
  const limited = enforceRateLimit("telemetry", `ip:${ip}`);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiada telemetría en poco tiempo." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  const raw = await request.text();
  if (raw.length > TELEMETRY_MAX_BYTES) {
    recordTelemetryRejected();
    return NextResponse.json({ error: { code: "too_large", message: "Payload demasiado grande." } }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    recordTelemetryRejected();
    return NextResponse.json({ error: { code: "invalid", message: "JSON inválido." } }, { status: 400 });
  }

  const result = validateTelemetry(parsed);
  if (!result.ok || !result.event) {
    recordTelemetryRejected();
    // No devolvemos los detalles al cliente (podrían guiar abuso); se
    // registran agregados en observabilidad sin contenido.
    captureMessage("telemetría rechazada", { category: "telemetry", code: "schema_invalid" });
    return NextResponse.json({ ok: false, accepted: false }, { status: 422 });
  }

  const dayIso = new Date(Date.now()).toISOString().slice(0, 10);
  const accepted = ingestTelemetry(result.event, dayIso);
  return NextResponse.json({ ok: true, accepted, duplicate: !accepted });
}
