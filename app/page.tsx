import { cookies } from "next/headers";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/server/access";
import { readEnv } from "@/lib/server/env";
import AccessGate from "@/components/AccessGate";
import ConfigErrorScreen from "@/components/ConfigErrorScreen";
import VoiceAgentPage from "@/components/VoiceAgentPage";

export const dynamic = "force-dynamic";

/**
 * Puerta de entrada renderizada en servidor:
 * - sin configuración → pantalla de configuración pendiente,
 * - sin cookie válida → pantalla de passcode,
 * - autenticado → experiencia de voz.
 */
export default async function Home() {
  const { env, missing } = readEnv();
  if (!env) {
    return <ConfigErrorScreen missing={missing} />;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  const authenticated = verifyAccessToken(env.sessionSecret, token);

  if (!authenticated) {
    return <AccessGate appName={env.appName} />;
  }

  return <VoiceAgentPage appName={env.appName} agentName={env.agentName} />;
}
