"use client";

import type { AgentStatus } from "@/lib/shared/types";
import {
  CaptionsIcon,
  MicIcon,
  MicOffIcon,
  PowerIcon,
  RefreshIcon,
  StopIcon,
  TrashIcon,
} from "./Icons";

interface ControlBarProps {
  status: AgentStatus;
  isConnected: boolean;
  muted: boolean;
  showTranscript: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onStopSpeaking: () => void;
  onRestart: () => void;
  onToggleTranscript: () => void;
  onClearLog: () => void;
}

export default function ControlBar({
  status,
  isConnected,
  muted,
  showTranscript,
  onConnect,
  onDisconnect,
  onToggleMute,
  onStopSpeaking,
  onRestart,
  onToggleTranscript,
  onClearLog,
}: ControlBarProps) {
  const busy = status === "connecting" || status === "requesting_mic" || status === "reconnecting";

  return (
    <div className="control-bar">
      {isConnected ? (
        <button className="btn btn-danger-outline btn-main" onClick={onDisconnect}>
          <PowerIcon size={20} />
          Finalizar
        </button>
      ) : (
        <button className="btn btn-primary btn-main" onClick={onConnect} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden /> : <PowerIcon size={20} />}
          {status === "requesting_mic"
            ? "Permite el micrófono…"
            : status === "reconnecting"
              ? "Reconectando…"
              : busy
                ? "Conectando…"
                : "Conectar cerebro"}
        </button>
      )}

      <div className="control-secondary">
        <button
          className="icon-btn"
          onClick={onToggleMute}
          disabled={!isConnected}
          aria-pressed={muted}
          aria-label={muted ? "Activar micrófono" : "Silenciar micrófono"}
          title={muted ? "Activar micrófono" : "Silenciar micrófono"}
          data-active={muted}
        >
          {muted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button
          className="icon-btn"
          onClick={onStopSpeaking}
          disabled={status !== "speaking" && status !== "thinking"}
          aria-label="Cortar la voz del agente"
          title="Cortar la voz del agente"
        >
          <StopIcon />
        </button>
        <button
          className="icon-btn"
          onClick={onRestart}
          disabled={busy}
          aria-label="Reiniciar sesión"
          title="Reiniciar sesión"
        >
          <RefreshIcon />
        </button>
        <button
          className="icon-btn"
          onClick={onToggleTranscript}
          aria-pressed={showTranscript}
          aria-label={showTranscript ? "Ocultar subtítulos" : "Mostrar subtítulos"}
          title={showTranscript ? "Ocultar subtítulos" : "Mostrar subtítulos"}
          data-active={showTranscript}
        >
          <CaptionsIcon />
        </button>
        <button
          className="icon-btn"
          onClick={onClearLog}
          aria-label="Borrar conversación"
          title="Borrar conversación"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
