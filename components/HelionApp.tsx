"use client";

import { useCallback, useEffect, useState } from "react";
import { useConversationLog } from "@/hooks/useConversationLog";
import { useMicrophoneLevel } from "@/hooks/useMicrophoneLevel";
import { useRealtimeSession } from "@/hooks/useRealtimeSession";
import AdvancedExperience from "./AdvancedExperience";
import MinimalVoiceExperience from "./MinimalVoiceExperience";

/**
 * Contenedor raíz de la experiencia: es dueño de la sesión de voz y del
 * registro de conversación, y decide qué cara mostrar — la experiencia
 * pública minimalista (por defecto) o la consola técnica avanzada.
 * La sesión se comparte: cambiar de modo no corta la conversación.
 */

export default function HelionApp({
  appName,
  agentName,
  initialAdvanced = false,
}: {
  appName: string;
  agentName: string;
  initialAdvanced?: boolean;
}) {
  const log = useConversationLog();
  const realtime = useRealtimeSession(log);
  const micLevelRef = useMicrophoneLevel(realtime.micStream);
  const agentLevelRef = useMicrophoneLevel(realtime.agentStream);

  const [advanced, setAdvanced] = useState(initialAdvanced);
  const [sendingText, setSendingText] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") === "1") {
      setAdvanced(true);
    }
  }, []);

  const handleSendText = useCallback(
    async (text: string) => {
      log.addUser(text);

      // Ruta principal: misma sesión de voz en tiempo real.
      if (realtime.sendText(text)) return;

      // Fallback: pipeline textual por servidor (/api/chat).
      setSendingText(true);
      try {
        const history = log.entries
          .filter((entry) => (entry.role === "user" || entry.role === "agent") && entry.text.trim() && !entry.pending)
          .slice(-12)
          .map((entry) => ({
            role: entry.role === "user" ? ("user" as const) : ("assistant" as const),
            content: entry.text,
          }));

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...history, { role: "user", content: text }] }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          log.addSystem(`No se pudo responder: ${body?.error?.message ?? "error del servidor."}`);
          return;
        }

        const data = (await response.json()) as { reply: string };
        const entryId = `fallback-${Date.now()}`;
        log.startAgent(entryId);
        log.appendAgent(entryId, data.reply);
        log.finalizeAgent(entryId);
      } catch {
        log.addSystem("No se pudo enviar el mensaje: revisa tu conexión.");
      } finally {
        setSendingText(false);
      }
    },
    [log, realtime],
  );

  const handlePower = useCallback(() => {
    if (realtime.isConnected) {
      realtime.disconnect();
      return;
    }
    void realtime.connect();
  }, [realtime]);

  if (advanced) {
    return (
      <AdvancedExperience
        appName={appName}
        agentName={agentName}
        log={log}
        realtime={realtime}
        micLevelRef={micLevelRef}
        agentLevelRef={agentLevelRef}
        sendingText={sendingText}
        onSendText={handleSendText}
        onExit={() => setAdvanced(false)}
      />
    );
  }

  return (
    <MinimalVoiceExperience
      appName={appName}
      status={realtime.status}
      error={realtime.error}
      isConnected={realtime.isConnected}
      listenMode={realtime.listenMode}
      pttActive={realtime.pttActive}
      micLevelRef={micLevelRef}
      agentLevelRef={agentLevelRef}
      onPower={handlePower}
      onPttChange={realtime.setPttActive}
      onResumeAudio={realtime.resumeAudio}
      onAdvanced={() => setAdvanced(true)}
      orbPulse={realtime.orbPulse}
      micUnavailable={
        realtime.muted ||
        realtime.error?.code === "mic_permission" ||
        realtime.error?.code === "mic_unavailable" ||
        realtime.error?.code === "mic_lost" ||
        realtime.error?.code === "browser_unsupported"
      }
      wakeDirected={realtime.wakeDirected}
      attentive={realtime.attentive}
      agentNameHint={realtime.agentNameHint}
      entries={log.entries}
      sendingText={sendingText}
      onSendText={handleSendText}
      uiConfig={realtime.uiConfig}
    />
  );
}
