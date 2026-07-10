"use client";

import { useEffect, useState } from "react";
import type { AppError } from "@/lib/shared/errors";
import type { AgentStatus, LatencyReport, ListenMode, MicSettingsInfo, SessionInfo } from "@/lib/shared/types";
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
  micSettings: MicSettingsInfo | null;
  gate: { state: string; noiseFloor: number; threshold: number; blockedNoises: number; level: number };
  listenMode: ListenMode;
  lastLatency: LatencyReport | null;
}

interface ServerConfig {
  profile?: { displayName?: string; role?: string };
  model?: string;
  voice?: string;
  agentName?: string;
  turnDetection?: string;
  transcriptionModel?: string;
  textModel?: string;
  voiceEngine?: string;
  elevenLabsConfigured?: boolean;
  elevenLabsVoiceId?: string | null;
  elevenLabsModel?: string;
  audio?: { profile?: string; noiseReduction?: string; gateEnabled?: boolean };
  memory?: { enabled?: boolean; provider?: string };
}

/**
 * Panel ocultable de diagnóstico. Muestra configuración no sensible,
 * estado de la sesión y recomendaciones básicas cuando algo falla.
 */
export default function DiagnosticsPanel({
  open,
  onClose,
  data,
  onCalibrate,
}: {
  open: boolean;
  onClose: () => void;
  data: DiagnosticsData;
  onCalibrate: () => void;
}) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [browserInfo, setBrowserInfo] = useState({ userAgent: "", webrtc: false, online: true });
  const [identity, setIdentity] = useState<{ displayName?: string; role?: string; identityStatus?: string; trustLevel?: string; memoryScopes?: string[] } | null>(null);
  const [voiceTest, setVoiceTest] = useState<{ state: "idle" | "loading" | "playing" | "error"; message: string }>({
    state: "idle",
    message: "",
  });

  async function handleVoiceTest() {
    setVoiceTest({ state: "loading", message: "" });
    try {
      const response = await fetch("/api/voice/test");
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setVoiceTest({
          state: "error",
          message: body?.error?.message ?? "No se pudo generar la voz de prueba.",
        });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setVoiceTest({ state: "idle", message: "" });
      };
      await audio.play();
      setVoiceTest({ state: "playing", message: "" });
    } catch {
      setVoiceTest({ state: "error", message: "No se pudo reproducir el audio de prueba." });
    }
  }

  useEffect(() => {
    if (!open) return;
    setBrowserInfo({
      userAgent: navigator.userAgent,
      webrtc: "RTCPeerConnection" in window && !!navigator.mediaDevices?.getUserMedia,
      online: navigator.onLine,
    });
    fetch("/api/identity/current").then((r) => (r.ok ? r.json() : null)).then(setIdentity).catch(() => {});
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

  const engine = data.sessionInfo?.engine ?? config?.voiceEngine ?? "—";

  const applied = data.micSettings?.applied;
  const boolLabel = (value: boolean | null | undefined) =>
    value === true ? "sí" : value === false ? "no" : "desconocido";

  const rows: Array<[string, string]> = [
    ["Identidad actual", identity ? `${identity.displayName} · ${identity.role} · ${identity.identityStatus} · ${identity.trustLevel}` : "—"],
    ["Scopes de memoria", identity?.memoryScopes?.join(", ") ?? "—"],
    ["Modelo realtime", model],
    ["Motor de voz", engine],
    ["Voz", voice],
    ["ElevenLabs", config?.elevenLabsConfigured ? `configurado (${config?.elevenLabsModel ?? "—"})` : "sin configurar"],
    ["Detección de turnos", config?.turnDetection ?? "—"],
    ["Perfil de audio", config?.audio?.profile ?? "—"],
    ["Reducción de ruido (OpenAI)", config?.audio?.noiseReduction ?? "—"],
    ["Modo de escucha", data.listenMode === "ptt" ? "pulsar para hablar" : "automático"],
    ["Micrófono (dispositivo)", data.micSettings?.deviceLabel ?? "—"],
    [
      "Constraints aplicadas",
      applied
        ? `EC ${boolLabel(applied.echoCancellation)} · NS ${boolLabel(applied.noiseSuppression)} · AGC ${boolLabel(applied.autoGainControl)}`
        : "—",
    ],
    ["Gate local", data.gate.state],
    ["Nivel RMS actual", data.gate.level.toFixed(4)],
    ["Ruido de fondo estimado", data.gate.noiseFloor.toFixed(4)],
    ["Umbral dinámico", Number.isFinite(data.gate.threshold) ? data.gate.threshold.toFixed(4) : "—"],
    ["Ruidos bloqueados", String(data.gate.blockedNoises)],
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

        {data.lastLatency && (
          <>
            <h3 className="diag-subtitle">Latencia (última respuesta)</h3>
            <dl className="diag-grid">
              {(
                [
                  ["Fin de voz → primer audio SONANDO", data.lastLatency.speechEndToFirstAudioPlayMs],
                  ["Fin de voz → primer delta de texto", data.lastLatency.speechEndToFirstTextDeltaMs],
                  ["Primer delta → envío a TTS", data.lastLatency.firstTextDeltaToTtsSendMs],
                  ["Envío TTS → primer byte de audio", data.lastLatency.ttsSendToFirstAudioByteMs],
                  ["Primer byte → reproducción", data.lastLatency.firstAudioByteToPlayMs],
                  ["Fin de voz → respuesta completa", data.lastLatency.totalResponseDoneMs],
                ] as Array<[string, number | null]>
              ).map(([label, value]) => (
                <div className="diag-row" key={label}>
                  <dt>{label}</dt>
                  <dd>{value !== null ? `${value} ms` : "—"}</dd>
                </div>
              ))}
              <div className="diag-row">
                <dt>Modo TTS / transporte</dt>
                <dd>
                  {data.lastLatency.ttsMode} / {data.lastLatency.transport}
                </dd>
              </div>
              <div className="diag-row">
                <dt>Chunks / primer chunk</dt>
                <dd>
                  {data.lastLatency.chunksSent} · {data.lastLatency.firstChunkChars ?? "—"} chars
                  {data.lastLatency.fallbackUsed ? " · fallback" : ""}
                  {data.lastLatency.cancelled ? " · cancelada" : ""}
                  {data.lastLatency.hadToolCalls ? " · tools" : ""}
                </dd>
              </div>
            </dl>
          </>
        )}

        <button
          className="btn btn-small"
          onClick={() => {
            void fetch("/api/identity/reset", { method: "POST" }).then(() => window.location.reload());
          }}
        >
          Resetear identidad de sesión
        </button>

        <h3 className="diag-subtitle">Escucha</h3>
        <p className="diag-note">
          «Escuchando» solo aparece cuando el gate local detecta voz humana sostenida. Si cambias de
          sala o de ruido de fondo, recalibra.
        </p>
        <button className="btn btn-small" onClick={onCalibrate}>
          Calibrar ambiente
        </button>

        <h3 className="diag-subtitle">Prueba de voz española</h3>
        <p className="diag-note">
          Genera y reproduce con ElevenLabs una frase fija en castellano para comprobar si la voz
          suena nativa. Requiere <code>ELEVENLABS_API_KEY</code> y <code>ELEVENLABS_VOICE_ID</code>;
          funciona aunque el motor activo sea <code>openai_realtime</code>.
        </p>
        <button
          className="btn btn-small"
          onClick={() => void handleVoiceTest()}
          disabled={voiceTest.state === "loading" || voiceTest.state === "playing"}
        >
          {voiceTest.state === "loading"
            ? "Generando voz…"
            : voiceTest.state === "playing"
              ? "Reproduciendo…"
              : "▶ Probar voz española"}
        </button>
        {voiceTest.state === "error" && <p className="diag-test-error">{voiceTest.message}</p>}

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
