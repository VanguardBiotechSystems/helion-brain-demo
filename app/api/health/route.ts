import { NextResponse } from "next/server";
import { readEnv } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/**
 * Salud básica de la aplicación. Público y sin secretos:
 * solo booleanos de configuración, nunca valores.
 */
export async function GET() {
  const { missing } = readEnv();
  return NextResponse.json({
    status: missing.length === 0 ? "ok" : "degraded",
    app: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Helion",
    time: new Date().toISOString(),
    checks: {
      openaiKeyConfigured: !missing.includes("OPENAI_API_KEY"),
      accessPasswordConfigured: !missing.includes("APP_ACCESS_PASSWORD"),
    },
  });
}
