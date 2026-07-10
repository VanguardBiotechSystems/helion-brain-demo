"use client";

import { useRef, type RefObject } from "react";
import type { AppError } from "@/lib/shared/errors";
import type { AgentStatus, ListenMode } from "@/lib/shared/types";
import HelionOrb from "./HelionOrb";
import { statusLabel } from "./ConnectionStatus";

/**
 * Experiencia pública minimalista: solo el orbe de Helion, una línea de
 * estado y un botón liquid glass. Nada de chat, paneles ni controles
 * técnicos. El modo avanzado se abre con triple clic en la línea de estado
 * o con ?debug=1 en la URL.
 */

interface MinimalVoiceExperienceProps {
  appName: string;
  status: AgentStatus;
  error: AppError | null;
  isConnected: boolean;
  listenMode: ListenMode;
  pttActive: boolean;
  micLevelRef: RefObject<number>;
  agentLevelRef: RefObject<number>;
  onPower: () => void;
  onPttChange: (active: boolean) => void;
  onResumeAudio: () => void;
  onAdvanced: () => void;
}

function minimalErrorMessage(error: AppError): string {
  if (error.code === "mic_permission" || error.code === "mic_unavailable") {
    return "Activa el micrófono para hablar con Helion.";
  }
  return error.message;
}

export default function MinimalVoiceExperience({
  appName,
  status,
  error,
  isConnected,
  listenMode,
  pttActive,
  micLevelRef,
  agentLevelRef,
  onPower,
  onPttChange,
  onResumeAudio,
  onAdvanced,
}: MinimalVoiceExperienceProps) {
  const tapsRef = useRef<number[]>([]);

  // Triple clic discreto en la línea de estado → modo avanzado.
  function handleSecretTap() {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((t) => now - t < 1500), now];
    if (tapsRef.current.length >= 3) {
      tapsRef.current = [];
      onAdvanced();
    }
  }

  const busy = status === "connecting" || status === "requesting_mic" || status === "reconnecting";
  const showPtt = isConnected && listenMode === "ptt";

  const buttonLabel = busy
    ? status === "reconnecting"
      ? "Reconectando…"
      : "Conectando…"
    : status === "calibrating"
      ? "Calibrando…"
      : isConnected
        ? `Apagar ${appName}`
        : `Encender ${appName}`;

  // Durante los estados transitorios el botón ya lleva el texto
  // («Conectando…», «Calibrando…»): la línea de estado calla para no duplicar.
  const buttonCarriesStatus =
    busy || status === "calibrating" || status === "idle" || status === "error";
  const statusText = buttonCarriesStatus
    ? ""
    : showPtt && !pttActive
      ? "Pulsa y mantén para hablar"
      : statusLabel(status).replace("…", "");

  return (
    <div className="min-shell">
      <span className="min-brand" aria-hidden>
        {appName}
      </span>

      <HelionOrb status={status} micLevelRef={micLevelRef} agentLevelRef={agentLevelRef} />

      <p
        className="min-status"
        onClick={handleSecretTap}
        title=""
        aria-live="polite"
      >
        {statusText || " "}
      </p>

      {error && (
        <p className="min-error" role="alert">
          {minimalErrorMessage(error)}
          {error.code === "audio_playback" && (
            <>
              {" "}
              <button className="min-inline-link" onClick={onResumeAudio}>
                Activar audio
              </button>
            </>
          )}
        </p>
      )}

      {showPtt ? (
        <>
          <button
            className={`lg-button lg-ptt ${pttActive ? "lg-ptt-active" : ""}`}
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
            {pttActive ? "Hablando…" : "Mantén para hablar"}
          </button>
          <button className="min-off-link" onClick={onPower}>
            Apagar {appName}
          </button>
        </>
      ) : (
        <button className="lg-button" onClick={onPower} disabled={busy}>
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
