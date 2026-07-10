"use client";

import { useMemo, useState, type RefObject } from "react";
import type { ConversationLog } from "@/hooks/useConversationLog";
import type { RealtimeSession } from "@/hooks/useRealtimeSession";
import { useAccessSession } from "@/hooks/useAccessSession";
import ConnectionStatus, { statusLabel } from "./ConnectionStatus";
import ControlBar from "./ControlBar";
import DiagnosticsPanel from "./DiagnosticsPanel";
import ErrorBanner from "./ErrorBanner";
import MemoryPanel from "./MemoryPanel";
import MicLevelVisualizer from "./MicLevelVisualizer";
import TranscriptPanel from "./TranscriptPanel";
import { BrainIcon, CloseIcon, LogoutIcon, WrenchIcon } from "./Icons";

/**
 * Modo avanzado (oculto en la demo pública): la consola técnica completa —
 * transcript, controles, diagnóstico, memoria y estados detallados.
 * Se entra con triple clic en el estado de la experiencia minimalista o
 * con ?debug=1; se sale con el botón ✕ de la cabecera.
 */

interface AdvancedExperienceProps {
  appName: string;
  agentName: string;
  log: ConversationLog;
  realtime: RealtimeSession;
  micLevelRef: RefObject<number>;
  agentLevelRef: RefObject<number>;
  sendingText: boolean;
  onSendText: (text: string) => Promise<void> | void;
  onExit: () => void;
}

export default function AdvancedExperience({
  appName,
  agentName,
  log,
  realtime,
  micLevelRef,
  agentLevelRef,
  sendingText,
  onSendText,
  onExit,
}: AdvancedExperienceProps) {
  const { logout } = useAccessSession();
  const [showTranscript, setShowTranscript] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showMemory, setShowMemory] = useState(false);

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
            <div className="brand-tag">Modo avanzado · consola técnica</div>
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
          <button
            className="icon-btn"
            onClick={onExit}
            aria-label="Salir del modo avanzado"
            title="Salir del modo avanzado"
          >
            <CloseIcon />
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
            onSendText={onSendText}
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
          lastLatency: realtime.lastLatency,
          sessionStats: realtime.sessionStats,
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
