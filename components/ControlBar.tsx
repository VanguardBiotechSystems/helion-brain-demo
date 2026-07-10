"use client";

import type { AgentStatus, ListenMode } from "@/lib/shared/types";
import {
  CaptionsIcon,
  HandIcon,
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
  listenMode: ListenMode;
  pttActive: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onStopSpeaking: () => void;
  onRestart: () => void;
  onToggleTranscript: () => void;
  onClearLog: () => void;
  onSetListenMode: (mode: ListenMode) => void;
  onPttChange: (active: boolean) => void;
}

export default function ControlBar({
  status,
  isConnected,
  muted,
  showTranscript,
  listenMode,
  pttActive,
  onConnect,
  onDisconnect,
  onToggleMute,
  onStopSpeaking,
  onRestart,
  onToggleTranscript,
  onClearLog,
  onSetListenMode,
  onPttChange,
}: ControlBarProps) {
  const busy = status === "connecting" || status === "requesting_mic" || status === "reconnecting";

  return (
    <div className="control-bar">
      {isConnected ? (
        <>
          {listenMode === "ptt" && (
            <button
              className={`btn btn-primary btn-main ptt-button ${pttActive ? "ptt-active" : ""}`}
              onPointerDown={(event) => {
                event.preventDefault();
                onPttChange(true);
              }}
              onPointerUp={() => onPttChange(false)}
              onPointerLeave={() => onPttChange(false)}
              onPointerCancel={() => onPttChange(false)}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  onPttChange(true);
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") onPttChange(false);
              }}
              aria-pressed={pttActive}
            >
              <MicIcon size={20} />
              {pttActive ? "Hablando… (suelta para enviar)" : "Mantén pulsado para hablar"}
            </button>
          )}
          <button className="btn btn-danger-outline btn-main" onClick={onDisconnect}>
            <PowerIcon size={20} />
            Finalizar
          </button>
        </>
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
          onClick={() => onSetListenMode(listenMode === "auto" ? "ptt" : "auto")}
          aria-pressed={listenMode === "ptt"}
          aria-label={
            listenMode === "auto"
              ? "Cambiar a modo pulsar para hablar"
              : "Cambiar a escucha automática"
          }
          title={
            listenMode === "auto"
              ? "Escucha: automática (clic para pulsar-para-hablar)"
              : "Escucha: pulsar para hablar (clic para automática)"
          }
          data-active={listenMode === "ptt"}
        >
          <HandIcon />
        </button>
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
