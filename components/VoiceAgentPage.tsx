"use client";

import { useCallback, useMemo, useState } from "react";
import { useAccessSession } from "@/hooks/useAccessSession";
import { useConversationLog } from "@/hooks/useConversationLog";
import { useMicrophoneLevel } from "@/hooks/useMicrophoneLevel";
import { useRealtimeSession } from "@/hooks/useRealtimeSession";
import ConnectionStatus, { statusLabel } from "./ConnectionStatus";
import ControlBar from "./ControlBar";
import DiagnosticsPanel from "./DiagnosticsPanel";
import ErrorBanner from "./ErrorBanner";
import MemoryPanel from "./MemoryPanel";
import MicLevelVisualizer from "./MicLevelVisualizer";
import TranscriptPanel from "./TranscriptPanel";
import { BrainIcon, LogoutIcon, WrenchIcon } from "./Icons";

/**
 * Pantalla principal: orbe de voz + controles + subtítulos + diagnóstico.
 * Toda la lógica WebRTC/Realtime vive en useRealtimeSession; aquí solo se
 * compone la experiencia.
 */
export default function VoiceAgentPage({
  appName,
  agentName,
}: {
  appName: string;
  agentName: string;
}) {
  const log = useConversationLog();
  const realtime = useRealtimeSession(log);
  const micLevelRef = useMicrophoneLevel(realtime.micStream);
  const agentLevelRef = useMicrophoneLevel(realtime.agentStream);
  const { logout } = useAccessSession();

  const [showTranscript, setShowTranscript] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [sendingText, setSendingText] = useState(false);

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

  const errorAction = useMemo(() => {
    if (!realtime.error) return null;
    switch (realtime.error.code) {
      case "audio_playback":
        return { label: "Activar audio", onClick: realtime.resumeAudio };
      case "not_authenticated":
        return { label: "Recargar", onClick: () => window.location.reload() };
      case "mic_permission":
      case "webrtc_failed":
      case "session_create_failed":
      case "openai_error":
      case "unknown":
        return realtime.isConnected ? null : { label: "Reintentar", onClick: () => void realtime.connect() };
      default:
        return null;
    }
  }, [realtime]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <div className="brand-name">{appName}</div>
            <div className="brand-tag">Cerebro conversacional · robot humanoide</div>
          </div>
        </div>
        <div className="topbar-right">
          <ConnectionStatus status={realtime.status} muted={realtime.muted} />
          <button
            className="icon-btn"
            onClick={() => setShowMemory(true)}
            aria-label="Abrir memoria"
            title="Memoria"
            data-active={realtime.memoryEnabled && realtime.memoryActive}
          >
            <BrainIcon />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowDiagnostics(true)}
            aria-label="Abrir diagnóstico"
            title="Diagnóstico"
          >
            <WrenchIcon />
          </button>
          <button className="icon-btn" onClick={() => void logout()} aria-label="Salir" title="Salir">
            <LogoutIcon />
          </button>
        </div>
      </header>

      <ErrorBanner error={realtime.error} onDismiss={realtime.clearError} action={errorAction} />

      <main className={`main ${showTranscript ? "with-transcript" : ""}`}>
        <section className="stage">
          <MicLevelVisualizer
            status={realtime.status}
            micLevelRef={micLevelRef}
            agentLevelRef={agentLevelRef}
          />

          <div className="status-line">
            <span className="status-label" data-status={realtime.status}>
              {realtime.status === "idle" ? `${agentName} en espera` : statusLabel(realtime.status)}
            </span>
            {realtime.latencyMs !== null && realtime.isConnected && (
              <span className="latency-chip" title="Tiempo entre el fin de tu frase y el inicio de la respuesta">
                ~{realtime.latencyMs} ms
              </span>
            )}
          </div>

          <ControlBar
            status={realtime.status}
            isConnected={realtime.isConnected}
            muted={realtime.muted}
            showTranscript={showTranscript}
            listenMode={realtime.listenMode}
            pttActive={realtime.pttActive}
            onConnect={() => void realtime.connect()}
            onDisconnect={realtime.disconnect}
            onToggleMute={realtime.toggleMute}
            onStopSpeaking={realtime.stopSpeaking}
            onRestart={() => void realtime.restart()}
            onToggleTranscript={() => setShowTranscript((current) => !current)}
            onClearLog={log.clear}
            onSetListenMode={realtime.setListenMode}
            onPttChange={realtime.setPttActive}
          />

          <p className="stage-note">
            Voz en tiempo real · las acciones físicas del robot se simulan — sin hardware conectado.
          </p>
        </section>

        {showTranscript && (
          <TranscriptPanel
            entries={log.entries}
            connected={realtime.isConnected}
            sending={sendingText}
            onSendText={handleSendText}
          />
        )}
      </main>

      <DiagnosticsPanel
        open={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        onCalibrate={realtime.calibrateAmbient}
        data={{
          sessionInfo: realtime.sessionInfo,
          status: realtime.status,
          connectionState: realtime.connectionState,
          dataChannelState: realtime.dataChannelState,
          micActive: realtime.micStream !== null,
          muted: realtime.muted,
          lastError: realtime.error,
          eventCount: realtime.eventCount,
          latencyMs: realtime.latencyMs,
          messageCount: log.count,
          micSettings: realtime.micSettings,
          gate: realtime.gate,
          listenMode: realtime.listenMode,
        }}
      />

      <MemoryPanel
        open={showMemory}
        onClose={() => setShowMemory(false)}
        memoryActive={realtime.memoryActive}
        onToggleActive={realtime.setMemoryActive}
        lastRecall={realtime.lastRecall}
        memorySavedCount={realtime.memorySavedCount}
        onExtractNow={realtime.extractMemoryNow}
      />
    </div>
  );
}
