"use client";

import { useEffect, useState } from "react";
import type { AppError } from "@/lib/shared/errors";
import type { AgentStatus, SessionInfo } from "@/lib/shared/types";
import { statusLabel } from "./ConnectionStatus";
import { CloseIcon } from "./Icons";

interface DiagnosticsData {
  sessionInfo: SessionInfo | null;
  status: AgentStatus;
  connectionState: string;
  dataChannelState: string;
  micActive: boolean;
  muted: boolean;
  lastError: AppError | null;
  eventCount: number;
  latencyMs: number | null;
  messageCount: number;
}

interface ServerConfig {
  model?: string;
  voice?: string;
  agentName?: string;
  turnDetection?: string;
  transcriptionModel?: string;
  textModel?: string;
}

/**
 * Panel ocultable de diagnóstico. Muestra configuración no sensible,
 * estado de la sesión y recomendaciones básicas cuando algo falla.
 */
export default function DiagnosticsPanel({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: DiagnosticsData;
}) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [browserInfo, setBrowserInfo] = useState({ userAgent: "", webrtc: false, online: true });

  useEffect(() => {
    if (!open) return;
    setBrowserInfo({
      userAgent: navigator.userAgent,
      webrtc: "RTCPeerConnection" in window && !!navigator.mediaDevices?.getUserMedia,
      online: navigator.onLine,
    });
    if (!config) {
      fetch("/api/config")
        .then((response) => (response.ok ? response.json() : null))
        .then((body: ServerConfig | null) => {
          if (body) setConfig(body);
        })
        .catch(() => {});
    }
  }, [open, config]);

  if (!open) return null;

  const model = data.sessionInfo?.model ?? config?.model ?? "—";
  const voice = data.sessionInfo?.voice ?? config?.voice ?? "—";

  const recommendations: string[] = [];
  if (!browserInfo.webrtc) {
    recommendations.push("Este navegador no soporta WebRTC. Usa Chrome, Edge o Safari recientes.");
  }
  if (!browserInfo.online) {
    recommendations.push("Sin conexión a internet: revisa la red antes de reconectar.");
  }
  if (data.lastError?.code === "mic_permission") {
    recommendations.push(
      "Permiso de micrófono denegado: pulsa el candado junto a la URL → Micrófono → Permitir, y reconecta.",
    );
  }
  if (data.lastError?.code === "audio_playback") {
    recommendations.push("Audio bloqueado por el navegador: usa el botón «Activar audio» del aviso.");
  }
  if (data.connectionState === "failed") {
    recommendations.push("La conexión WebRTC falló: puede ser un firewall o VPN restrictiva. Prueba otra red.");
  }
  if (data.status === "idle") {
    recommendations.push("Todo listo: pulsa «Conectar cerebro» para iniciar la sesión de voz.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Sin incidencias detectadas.");
  }

  const rows: Array<[string, string]> = [
    ["Modelo realtime", model],
    ["Voz", voice],
    ["Detección de turnos", config?.turnDetection ?? "—"],
    ["Transcripción", config?.transcriptionModel ?? "—"],
    ["Modelo texto (fallback)", config?.textModel ?? "—"],
    ["Estado del agente", statusLabel(data.status)],
    ["Conexión WebRTC", data.connectionState],
    ["Canal de datos", data.dataChannelState],
    ["Micrófono", data.micActive ? (data.muted ? "activo (silenciado)" : "activo") : "inactivo"],
    ["Latencia respuesta", data.latencyMs !== null ? `~${data.latencyMs} ms` : "—"],
    ["Eventos de sesión", String(data.eventCount)],
    ["Mensajes en registro", String(data.messageCount)],
    ["Último error", data.lastError ? `${data.lastError.code}: ${data.lastError.message}` : "ninguno"],
    ["WebRTC disponible", browserInfo.webrtc ? "sí" : "no"],
    ["Navegador", browserInfo.userAgent],
  ];

  return (
    <div className="diag-overlay" onClick={onClose}>
      <section
        className="diag-panel"
        role="dialog"
        aria-label="Panel de diagnóstico"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="diag-head">
          <h2>Diagnóstico</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar diagnóstico">
            <CloseIcon />
          </button>
        </div>

        <dl className="diag-grid">
          {rows.map(([label, value]) => (
            <div className="diag-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="diag-subtitle">Recomendaciones</h3>
        <ul className="diag-recos">
          {recommendations.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
