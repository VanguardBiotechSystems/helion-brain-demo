import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import { getProfileById } from "@/lib/server/profiles";
import { buildTextFallbackInstructions } from "@/lib/server/personality";
import { mapOpenAiFailure } from "@/lib/server/realtime";
import { clientIpFrom, enforceRateLimit } from "@/lib/server/rateLimit";
import { logError } from "@/lib/server/log";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function sanitizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages: ChatMessage[] = [];
  for (const item of raw.slice(-MAX_MESSAGES)) {
    const role = (item as { role?: unknown })?.role;
    const content = (item as { content?: unknown })?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    if (content.length === 0) continue;
    messages.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  return messages.length > 0 ? messages : null;
}

/**
 * Fallback textual: mismo cerebro y personalidad, sin audio.
 * Pipeline encadenado clásico (texto → LLM → texto) para cuando el
 * micrófono o WebRTC no estén disponibles.
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

  const ip = clientIpFrom(request.headers);
  const { allowed, retryAfterMs } = enforceRateLimit("chat", `ip:${ip}`);
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Demasiados mensajes en poco tiempo." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  const messages = sanitizeMessages(body?.messages);
  if (!messages) {
    return NextResponse.json(
      { error: { code: "unknown", message: "Formato de mensajes no válido." } },
      { status: 400 },
    );
  }

  let response: Response;
  try {
    response = await fetch(`${env.openaiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.textModel,
        messages: [
          { role: "system", content: buildTextFallbackInstructions(env.agentName) },
          ...messages,
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
      cache: "no-store",
    });
  } catch (error) {
    logError("chat", "No se pudo contactar con la API de OpenAI", error);
    return NextResponse.json(
      { error: { code: "openai_error", message: "No se pudo contactar con OpenAI." } },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    logError("chat", `chat/completions fallo status=${response.status} body=${bodyText.slice(0, 600)}`);
    const failure = mapOpenAiFailure(response.status, bodyText);
    return NextResponse.json({ error: { code: failure.code, message: failure.message } }, { status: 502 });
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const reply = data?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    return NextResponse.json(
      { error: { code: "openai_error", message: "OpenAI devolvió una respuesta vacía." } },
      { status: 502 },
    );
  }

  return NextResponse.json({ reply });
}
