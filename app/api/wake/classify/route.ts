import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/server/apiGuard";
import { logError } from "@/lib/server/log";

export const dynamic = "force-dynamic";

/**
 * POST /api/wake/classify — clasificador de modelo para los casos AMBIGUOS del
 * AddressingGate (solo cuando las reglas devuelven "uncertain"). Timeout bajo;
 * si no responde a tiempo, el cliente aplica el fallback seguro (no responder
 * salvo alta confianza por reglas). Nunca persiste la transcripción.
 */
export async function POST(request: NextRequest) {
  const guard = requireAccess(request, { limiter: { name: "memory-read", limit: 120, windowMs: 600000 } });
  if (!guard.ok) return guard.response;

  const raw = await request.text();
  if (raw.length > 4000) return NextResponse.json({ ok: false }, { status: 413 });
  let body: { text?: unknown; agentName?: unknown } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const text = typeof body?.text === "string" ? body.text.slice(0, 500) : "";
  const agentName = typeof body?.agentName === "string" ? body.agentName.slice(0, 40) : "Helion";
  if (!text.trim()) return NextResponse.json({ ok: false }, { status: 400 });

  const system =
    `Clasifica si una frase va DIRIGIDA al asistente llamado ${agentName} (segunda persona, se le habla a él) ` +
    `o solo lo MENCIONA (tercera persona, se habla de él) o es ruido de fondo. Devuelve SOLO JSON: ` +
    `{"isAddressedToHelion":true|false,"confidence":"high|medium|low","reason":"...","classification":"direct_address|mention_only|background|uncertain","cleanedUserText":"..."}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 400);
  try {
    const res = await fetch(`${guard.env.openaiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guard.env.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: guard.env.textModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
        temperature: 0,
        max_tokens: 120,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) return NextResponse.json({ ok: false }, { status: 502 });
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json({ ok: false }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      isAddressedToHelion: parsed.isAddressedToHelion === true,
      confidence: ["high", "medium", "low"].includes(parsed.confidence as string) ? parsed.confidence : "low",
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
      classification: parsed.classification ?? "uncertain",
      cleanedUserText: typeof parsed.cleanedUserText === "string" ? parsed.cleanedUserText.slice(0, 500) : text,
    });
  } catch (error) {
    clearTimeout(timeout);
    // Timeout o fallo: el cliente aplica fallback seguro (no responder).
    if ((error as Error)?.name !== "AbortError") logError("wake", "clasificador falló", error);
    return NextResponse.json({ ok: false, reason: "timeout" }, { status: 200 });
  }
}
