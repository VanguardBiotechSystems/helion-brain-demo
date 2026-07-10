"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toAppError, type AppError, type ErrorCode } from "@/lib/shared/errors";
import type {
  AgentStatus,
  ClientGateConfig,
  ListenMode,
  MemorySummary,
  MicSettingsInfo,
  SessionInfo,
  SessionResponse,
  VoiceEngine,
} from "@/lib/shared/types";
import { mockRobot } from "@/lib/robot/mockAdapter";
import type { RobotCommand } from "@/lib/robot/types";
import {
  ROBOT_GESTURE_TOOL_NAME,
  SIMULATED_GESTURES,
  type SimulatedGesture,
} from "@/lib/robot/tools";
import { MEMORY_TOOL_NAMES } from "@/lib/server/memory/tools";
import { useAudioGate } from "./useAudioGate";
import type { ConversationLog } from "./useConversationLog";

/**
 * Máquina de estados de la sesión de voz en tiempo real (WebRTC + OpenAI Realtime).
 *
 * Escucha disciplinada (ver docs/AUDIO_GATE.md): el stream original del
 * micrófono se queda en el navegador para análisis; al modelo solo viaja un
 * CLON de la pista, que permanece silenciado salvo que el gate local
 * confirme voz humana sostenida (o que el usuario use pulsar-para-hablar).
 * "Escuchando" en la UI significa "creo que alguien está hablando", no
 * "tengo permiso de micrófono".
 *
 * Memoria (ver docs/MEMORY_ARCHITECTURE.md): al crear la sesión el servidor
 * inyecta recuerdos previos; durante la conversación se recuperan recuerdos
 * por turno, se acumulan intercambios para el Memory Curator y el modelo
 * dispone de herramientas memory_save / memory_recall / memory_forget.
 */

const MAX_RECONNECT_ATTEMPTS = 3;
const CONNECT_TIMEOUT_MS = 20000;
const DISCONNECT_GRACE_MS = 3000;
/** Estados en los que se puede re-derivar el estado "de reposo". */
const READY_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "calibrating",
  "standby",
  "voice_detected",
  "listening",
]);
const CONNECTED_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "calibrating",
  "standby",
  "voice_detected",
  "listening",
  "thinking",
  "speaking",
]);

interface RealtimeServerEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  text?: string;
  response_id?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  response?: {
    id?: string;
    status?: string;
    output?: Array<{ type?: string; name?: string; call_id?: string; arguments?: string }>;
  };
  error?: { type?: string; code?: string; message?: string };
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

/** Error interno con código de la taxonomía, para propagar por el flujo de conexión. */
class SessionError extends Error {
  constructor(public appError: AppError) {
    super(appError.message);
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Convierte cualquier excepción del flujo de conexión en un error con
 * mensaje humano en español. El detalle técnico (p. ej. "Failed to fetch")
 * se queda en consola, nunca en la UI.
 */
function mapCaughtError(caught: unknown): AppError {
  if (caught instanceof SessionError) return caught.appError;
  if (caught instanceof DOMException && (caught.name === "AbortError" || caught.name === "TimeoutError")) {
    return toAppError("session_create_failed", "La conexión tardó demasiado en responder.");
  }
  if (caught instanceof TypeError) {
    return typeof navigator !== "undefined" && navigator.onLine === false
      ? toAppError("network_offline")
      : toAppError("session_create_failed", "No se pudo contactar con el servidor.");
  }
  console.warn("[realtime] error no clasificado:", caught);
  return toAppError("unknown");
}

/** Códigos que merecen reintento automático cuando falla una reconexión. */
const RETRYABLE_ON_RECONNECT: ReadonlySet<string> = new Set([
  "network_offline",
  "webrtc_failed",
  "session_create_failed",
  "openai_error",
  "rate_limited",
  "unknown",
]);

function isKnownErrorCode(code: unknown): code is ErrorCode {
  return (
    typeof code === "string" &&
    [
      "not_authenticated",
      "rate_limited",
      "config_missing",
      "session_create_failed",
      "invalid_api_key",
      "model_unavailable",
      "quota_exceeded",
      "openai_error",
      "tts_failed",
    ].includes(code)
  );
}

function requestTimeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(ms)
    : undefined;
}

export interface GateDiagnostics {
  state: string;
  noiseFloor: number;
  threshold: number;
  blockedNoises: number;
  level: number;
}

interface ExchangeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RealtimeSession {
  status: AgentStatus;
  error: AppError | null;
  isConnected: boolean;
  muted: boolean;
  latencyMs: number | null;
  eventCount: number;
  sessionInfo: SessionInfo | null;
  micStream: MediaStream | null;
  agentStream: MediaStream | null;
  connectionState: string;
  dataChannelState: string;
  micSettings: MicSettingsInfo | null;
  listenMode: ListenMode;
  pttActive: boolean;
  gate: GateDiagnostics;
  memoryEnabled: boolean;
  memoryActive: boolean;
  lastRecall: MemorySummary[];
  memorySavedCount: number;
  connect(): Promise<void>;
  disconnect(): void;
  restart(): Promise<void>;
  toggleMute(): void;
  stopSpeaking(): void;
  sendText(text: string): boolean;
  resumeAudio(): void;
  clearError(): void;
  setListenMode(mode: ListenMode): void;
  setPttActive(active: boolean): void;
  calibrateAmbient(): void;
  extractMemoryNow(): Promise<void>;
  setMemoryActive(active: boolean): void;
}

export function useRealtimeSession(log: ConversationLog): RealtimeSession {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [error, setError] = useState<AppError | null>(null);
  const [muted, setMuted] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [agentStream, setAgentStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState("new");
  const [dataChannelState, setDataChannelState] = useState("closed");
  const [micSettings, setMicSettings] = useState<MicSettingsInfo | null>(null);
  const [listenMode, setListenModeState] = useState<ListenMode>("auto");
  const [pttActive, setPttActiveState] = useState(false);
  const [audioGateConfig, setAudioGateConfig] = useState<ClientGateConfig | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryActive, setMemoryActiveState] = useState(true);
  const [lastRecall, setLastRecall] = useState<MemorySummary[]>([]);
  const [memorySavedCount, setMemorySavedCount] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const sendTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const statusRef = useRef<AgentStatus>("idle");
  const mutedRef = useRef(false);
  const listenModeRef = useRef<ListenMode>("auto");
  const pttActiveRef = useRef(false);
  const gateOpenRef = useRef(false);
  const gateStateRef = useRef<string>("off");
  const gateEnabledRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const connectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechStoppedAtRef = useRef<number | null>(null);
  const processedCallsRef = useRef(new Set<string>());
  // Motor de voz de la sesión activa y estado del pipeline TTS (elevenlabs).
  const engineRef = useRef<VoiceEngine>("openai_realtime");
  const textBufferRef = useRef(new Map<string, string>());
  const ttsUrlRef = useRef<string | null>(null);
  const ttsStreamRef = useRef<MediaStream | null>(null);
  // Contador de generación: cualquier cancelación (barge-in, cortar voz,
  // reconexión) o una síntesis más nueva invalida las síntesis en vuelo.
  const ttsEpochRef = useRef(0);
  // Memoria: intercambios pendientes de curar y recuerdos ya inyectados.
  const memoryEnabledRef = useRef(false);
  const memoryActiveRef = useRef(true);
  const memoryAutoSaveRef = useRef(false);
  const exchangesRef = useRef<ExchangeMessage[]>([]);
  const extractWatermarkRef = useRef(0);
  const injectedMemoryIdsRef = useRef(new Set<string>());
  const logRef = useRef(log);

  logRef.current = log;

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const ensureAudioElement = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const element = new Audio();
      element.autoplay = true;
      audioRef.current = element;
    }
    return audioRef.current;
  }, []);

  /** Cambia el estado conversacional solo si la sesión sigue viva. */
  const setStatusSafe = useCallback((next: AgentStatus) => {
    if (intentionalCloseRef.current) return;
    if (dcRef.current?.readyState !== "open") return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  /**
   * Estado "de reposo" según el modo de escucha y el gate local.
   * Es la semántica visible: "Escuchando" = voz detectada, no micro abierto.
   */
  const deriveReadyStatus = useCallback((): AgentStatus => {
    if (mutedRef.current) return "standby";
    if (listenModeRef.current === "ptt") return pttActiveRef.current ? "listening" : "standby";
    if (!gateEnabledRef.current) return "listening";
    switch (gateStateRef.current) {
      case "calibrating":
        return "calibrating";
      case "candidate":
        return "voice_detected";
      case "open":
      case "hangover":
        return "listening";
      default:
        return "standby";
    }
  }, []);

  const applyReadyStatus = useCallback(() => {
    if (!READY_STATUSES.has(statusRef.current)) return;
    const next = deriveReadyStatus();
    if (next !== statusRef.current) setStatusSafe(next);
  }, [deriveReadyStatus, setStatusSafe]);

  /** El clon enviado al modelo solo se activa cuando toca hablar. */
  const updateSendEnabled = useCallback(() => {
    const track = sendTrackRef.current;
    if (!track) return;
    let shouldSend: boolean;
    if (listenModeRef.current === "ptt") {
      shouldSend = pttActiveRef.current;
    } else {
      shouldSend = gateEnabledRef.current ? gateOpenRef.current : true;
    }
    track.enabled = shouldSend && !mutedRef.current;
  }, []);

  const handleGateOpenChange = useCallback(
    (open: boolean) => {
      gateOpenRef.current = open;
      updateSendEnabled();
      applyReadyStatus();
    },
    [applyReadyStatus, updateSendEnabled],
  );

  const gateHook = useAudioGate(
    micStream,
    audioGateConfig,
    listenMode === "auto",
    handleGateOpenChange,
  );

  useEffect(() => {
    gateStateRef.current = gateHook.gateState;
    applyReadyStatus();
  }, [gateHook.gateState, applyReadyStatus]);

  const cleanupPeer = useCallback((keepMic: boolean) => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    const dc = dcRef.current;
    dcRef.current = null;
    if (dc) {
      dc.onopen = null;
      dc.onmessage = null;
      dc.onclose = null;
      try {
        dc.close();
      } catch {
        // ya cerrado
      }
    }
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      try {
        pc.close();
      } catch {
        // ya cerrado
      }
    }
    sendTrackRef.current?.stop();
    sendTrackRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current.removeAttribute("src");
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    ttsEpochRef.current += 1;
    ttsStreamRef.current = null;
    textBufferRef.current.clear();
    setAgentStream(null);
    setDataChannelState("closed");
    setConnectionState("closed");
    speechStoppedAtRef.current = null;
    if (!keepMic) {
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      setMicStream(null);
    }
  }, []);

  const sendEvent = useCallback((event: Record<string, unknown>): boolean => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify(event));
      return true;
    } catch {
      return false;
    }
  }, []);

  const recordLatency = useCallback(() => {
    if (speechStoppedAtRef.current !== null) {
      setLatencyMs(Math.round(performance.now() - speechStoppedAtRef.current));
      speechStoppedAtRef.current = null;
    }
  }, []);

  /** Detiene la reproducción TTS local e invalida las síntesis en vuelo. */
  const stopTtsPlayback = useCallback(() => {
    ttsEpochRef.current += 1;
    if (engineRef.current !== "elevenlabs") return;
    const element = audioRef.current;
    if (element) {
      try {
        element.pause();
        element.removeAttribute("src");
      } catch {
        // sin reproducción activa
      }
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
  }, []);

  /** Modo elevenlabs: sintetiza la respuesta en servidor y la reproduce. */
  const playTtsAudio = useCallback(
    async (text: string) => {
      if (engineRef.current !== "elevenlabs" || !text.trim()) return;
      const epoch = ++ttsEpochRef.current;
      try {
        setStatusSafe("thinking"); // preparando voz
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: requestTimeoutSignal(20000),
        });
        if (ttsEpochRef.current !== epoch) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
          const code = body?.error?.code;
          setError(toAppError(isKnownErrorCode(code) ? code : "tts_failed", body?.error?.message));
          setStatusSafe(deriveReadyStatus());
          return;
        }
        const blob = await response.blob();
        if (ttsEpochRef.current !== epoch) return;
        const element = ensureAudioElement();
        element.pause();
        if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
        const url = URL.createObjectURL(blob);
        ttsUrlRef.current = url;
        element.srcObject = null;
        element.src = url;
        element.onended = () => setStatusSafe(deriveReadyStatus());
        if (!ttsStreamRef.current) {
          const capturable = element as HTMLAudioElement & {
            captureStream?: () => MediaStream;
            mozCaptureStream?: () => MediaStream;
          };
          const capture = capturable.captureStream ?? capturable.mozCaptureStream;
          if (capture) {
            try {
              ttsStreamRef.current = capture.call(element);
              setAgentStream(ttsStreamRef.current);
            } catch {
              // sin analizador: no es fatal
            }
          }
        }
        await element.play();
        if (ttsEpochRef.current !== epoch) {
          element.pause();
          return;
        }
        recordLatency();
        setStatusSafe("speaking");
      } catch (caught) {
        // Una síntesis invalidada (p. ej. pause() durante play()) no es un error.
        if (ttsEpochRef.current !== epoch) return;
        if (caught instanceof DOMException && caught.name === "NotAllowedError") {
          setError(toAppError("audio_playback"));
        } else {
          setError(toAppError("tts_failed"));
        }
        setStatusSafe(deriveReadyStatus());
      }
    },
    [deriveReadyStatus, ensureAudioElement, recordLatency, setStatusSafe],
  );

  /** Cancela la respuesta activa (generación y audio) sea cual sea el motor. */
  const cancelActiveResponse = useCallback(() => {
    sendEvent({ type: "response.cancel" });
    if (engineRef.current === "elevenlabs") {
      stopTtsPlayback();
    } else {
      sendEvent({ type: "output_audio_buffer.clear" });
    }
  }, [sendEvent, stopTtsPlayback]);

  // ── Memoria ────────────────────────────────────────────────────────────

  const recordExchange = useCallback((role: "user" | "assistant", content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    exchangesRef.current.push({ role, content: trimmed.slice(0, 2000) });
    if (exchangesRef.current.length > 40) {
      const drop = exchangesRef.current.length - 40;
      exchangesRef.current.splice(0, drop);
      extractWatermarkRef.current = Math.max(0, extractWatermarkRef.current - drop);
    }
  }, []);

  /** El Memory Curator analiza el tramo pendiente cada pocos turnos. */
  const maybeExtractMemory = useCallback(async (force: boolean): Promise<void> => {
    if (!memoryEnabledRef.current || !memoryActiveRef.current || !memoryAutoSaveRef.current) return;
    const pending = exchangesRef.current.slice(extractWatermarkRef.current);
    const assistantTurns = pending.filter((message) => message.role === "assistant").length;
    if (pending.length === 0 || (!force && assistantTurns < 2)) return;
    extractWatermarkRef.current = exchangesRef.current.length;
    try {
      const response = await fetch("/api/memory/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: pending.slice(-12) }),
      });
      if (!response.ok) return;
      const data = (await response.json().catch(() => null)) as { saved?: unknown[] } | null;
      if (data?.saved?.length) setMemorySavedCount((count) => count + data.saved!.length);
    } catch {
      // la memoria nunca rompe la conversación
    }
  }, []);

  /** Recupera recuerdos relevantes al turno y los inyecta como contexto. */
  const maybeInjectMemories = useCallback(
    async (transcript: string): Promise<void> => {
      if (!memoryEnabledRef.current || !memoryActiveRef.current) return;
      const query = transcript.trim();
      if (query.length < 8) return;
      try {
        const response = await fetch("/api/memory/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, topK: 4 }),
        });
        if (!response.ok) return;
        const data = (await response.json().catch(() => null)) as { results?: MemorySummary[] } | null;
        const results = data?.results ?? [];
        setLastRecall(results.slice(0, 6));
        const fresh = results.filter(
          (memory) => !injectedMemoryIdsRef.current.has(memory.id) && (memory.score ?? 0) > 0.35,
        );
        if (fresh.length === 0) return;
        fresh.forEach((memory) => injectedMemoryIdsRef.current.add(memory.id));
        const block = fresh.map((memory) => `- (${memory.type}) ${memory.content}`).join("\n");
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `Recuerdos recuperados de la memoria persistente (contexto, no los cites literalmente):\n${block}`,
              },
            ],
          },
        });
      } catch {
        // la memoria nunca rompe la conversación
      }
    },
    [sendEvent],
  );

  const handleMemoryTool = useCallback(
    async (name: string, argsJson: string | undefined): Promise<Record<string, unknown>> => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      try {
        if (name === MEMORY_TOOL_NAMES.save) {
          const response = await fetch("/api/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: args.content,
              type: args.type,
              sensitivity: args.sensitivity,
            }),
          });
          const body = (await response.json().catch(() => null)) as {
            item?: { title?: string };
            deduplicatedInto?: string | null;
            error?: { message?: string };
          } | null;
          if (!response.ok) {
            return { saved: false, reason: body?.error?.message ?? "No se pudo guardar." };
          }
          setMemorySavedCount((count) => count + 1);
          return {
            saved: true,
            title: body?.item?.title ?? "",
            updatedExisting: Boolean(body?.deduplicatedInto),
          };
        }
        if (name === MEMORY_TOOL_NAMES.recall) {
          const response = await fetch("/api/memory/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: args.query, topK: 6 }),
          });
          const body = (await response.json().catch(() => null)) as { results?: MemorySummary[] } | null;
          if (!response.ok) return { memories: [], note: "Memoria no disponible ahora mismo." };
          const results = body?.results ?? [];
          setLastRecall(results.slice(0, 6));
          return {
            memories: results.map((memory) => ({
              type: memory.type,
              title: memory.title,
              content: memory.content,
              updatedAt: memory.updatedAt,
            })),
          };
        }
        if (name === MEMORY_TOOL_NAMES.forget) {
          const response = await fetch("/api/memory/forget", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: args.query }),
          });
          const body = (await response.json().catch(() => null)) as {
            archived?: Array<{ title: string }>;
          } | null;
          if (!response.ok) return { archived: [], note: "Memoria no disponible ahora mismo." };
          return { archived: (body?.archived ?? []).map((memory) => memory.title) };
        }
      } catch {
        return { error: "La memoria no está disponible ahora mismo." };
      }
      return { error: `Herramienta de memoria desconocida: ${name}` };
    },
    [],
  );

  // ── Herramientas (robot simulado + memoria) ───────────────────────────

  const handleFunctionCall = useCallback(
    async (name: string | undefined, callId: string | undefined, argsJson: string | undefined) => {
      if (!callId || processedCallsRef.current.has(callId)) return;
      processedCallsRef.current.add(callId);

      let output: Record<string, unknown>;
      if (
        name === MEMORY_TOOL_NAMES.save ||
        name === MEMORY_TOOL_NAMES.recall ||
        name === MEMORY_TOOL_NAMES.forget
      ) {
        output = await handleMemoryTool(name, argsJson);
      } else if (name === ROBOT_GESTURE_TOOL_NAME) {
        let parsed: { gesture?: string; detail?: string } = {};
        try {
          parsed = JSON.parse(argsJson || "{}") as { gesture?: string; detail?: string };
        } catch {
          parsed = {};
        }
        const gesture = (SIMULATED_GESTURES as readonly string[]).includes(parsed.gesture ?? "")
          ? (parsed.gesture as SimulatedGesture)
          : null;

        if (gesture) {
          const command: RobotCommand = {
            id: makeId(),
            type: gesture,
            params: { detail: parsed.detail },
            issuedAt: Date.now(),
            source: "agent",
          };
          const result = await mockRobot.execute(command);
          logRef.current.addAction({
            command: gesture,
            detail: parsed.detail,
            status: result.status === "simulated" ? "simulated" : "rejected",
          });
          output = { status: result.status, detail: result.detail, hardware_connected: false };
        } else {
          output = { status: "rejected", detail: "Gesto no reconocido." };
        }
      } else {
        output = { status: "rejected", detail: `Herramienta desconocida: ${name ?? "?"}` };
      }

      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      });
      sendEvent({ type: "response.create" });
    },
    [handleMemoryTool, sendEvent],
  );

  // ── Eventos del data channel ───────────────────────────────────────────

  const handleServerEvent = useCallback(
    (raw: string) => {
      let event: RealtimeServerEvent;
      try {
        event = JSON.parse(raw) as RealtimeServerEvent;
      } catch {
        return;
      }
      setEventCount((count) => count + 1);

      switch (event.type) {
        case "input_audio_buffer.speech_started":
          speechStoppedAtRef.current = null;
          // Barge-in: si la voz TTS local está sonando, se corta al hablar.
          stopTtsPlayback();
          setStatusSafe("listening");
          break;

        case "input_audio_buffer.speech_stopped":
          speechStoppedAtRef.current = performance.now();
          setStatusSafe("thinking");
          break;

        case "conversation.item.input_audio_transcription.delta":
          if (event.item_id && typeof event.delta === "string") {
            logRef.current.appendUserPartial(event.item_id, event.delta);
          }
          break;

        case "conversation.item.input_audio_transcription.completed":
          if (event.item_id) {
            const transcript = event.transcript ?? "";
            logRef.current.finalizeUser(event.item_id, transcript);
            recordExchange("user", transcript);
            void maybeInjectMemories(transcript);
          }
          break;

        case "response.created":
          setStatusSafe("thinking");
          if (event.response?.id) logRef.current.startAgent(event.response.id);
          break;

        // Nombre GA y nombre beta: se aceptan ambos por compatibilidad.
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
          recordLatency();
          if (event.response_id && typeof event.delta === "string") {
            logRef.current.appendAgent(event.response_id, event.delta);
          }
          break;

        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          if (event.response_id) {
            logRef.current.finalizeAgent(event.response_id, event.transcript);
            recordExchange("assistant", event.transcript ?? "");
            void maybeExtractMemory(false);
          }
          break;

        // Modo elevenlabs: la respuesta llega como texto (se sintetiza al
        // completarse, en response.done).
        case "response.output_text.delta":
          if (event.response_id && typeof event.delta === "string") {
            logRef.current.appendAgent(event.response_id, event.delta);
            textBufferRef.current.set(
              event.response_id,
              (textBufferRef.current.get(event.response_id) ?? "") + event.delta,
            );
          }
          break;

        case "response.output_text.done":
          if (event.response_id) {
            logRef.current.finalizeAgent(event.response_id, event.text);
            recordExchange("assistant", event.text ?? "");
            void maybeExtractMemory(false);
            if (typeof event.text === "string" && event.text.trim()) {
              textBufferRef.current.set(event.response_id, event.text);
            }
          }
          break;

        case "output_audio_buffer.started":
          recordLatency();
          setStatusSafe("speaking");
          break;

        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          setStatusSafe(deriveReadyStatus());
          break;

        case "response.function_call_arguments.done":
          void handleFunctionCall(event.name, event.call_id, event.arguments);
          break;

        case "response.done": {
          for (const item of event.response?.output ?? []) {
            if (item?.type === "function_call") {
              void handleFunctionCall(item.name, item.call_id, item.arguments);
            }
          }
          const responseId = event.response?.id;
          if (engineRef.current === "elevenlabs" && responseId) {
            const text = textBufferRef.current.get(responseId) ?? "";
            textBufferRef.current.delete(responseId);
            if (event.response?.status === "completed" && text.trim()) {
              void playTtsAudio(text);
              break;
            }
          }
          // Si la respuesta no produjo audio, vuelve al estado de reposo.
          if (statusRef.current === "thinking") setStatusSafe(deriveReadyStatus());
          break;
        }

        case "error": {
          const code = event.error?.code ?? "";
          // Errores benignos: cancelar sin respuesta activa, o pedir una
          // respuesta cuando ya hay una en curso (se resuelve solo).
          if (code.includes("cancel") || code === "conversation_already_has_active_response") break;
          console.warn("[realtime] error del servidor:", event.error);
          setError(toAppError("openai_error", event.error?.message));
          break;
        }

        default:
          break;
      }
    },
    [
      deriveReadyStatus,
      handleFunctionCall,
      maybeExtractMemory,
      maybeInjectMemories,
      playTtsAudio,
      recordExchange,
      recordLatency,
      setStatusSafe,
      stopTtsPlayback,
    ],
  );

  const scheduleReconnectRef = useRef<() => void>(() => {});

  // ── Conexión ───────────────────────────────────────────────────────────

  const connectInternal = useCallback(
    async (isReconnect: boolean) => {
      if (connectingRef.current || pcRef.current) return;
      if (typeof window === "undefined") return;

      if (!("RTCPeerConnection" in window) || !navigator.mediaDevices?.getUserMedia) {
        setError(toAppError("browser_unsupported"));
        setStatus("error");
        statusRef.current = "error";
        return;
      }

      connectingRef.current = true;
      intentionalCloseRef.current = false;
      setError(null);

      try {
        // 1) Sesión efímera desde nuestro servidor: trae también la
        //    configuración del gate local y de memoria.
        setStatus("connecting");
        statusRef.current = "connecting";
        const sessionResponse = await fetch("/api/session", {
          method: "POST",
          signal: requestTimeoutSignal(15000),
        });
        if (!sessionResponse.ok) {
          const body = (await sessionResponse.json().catch(() => null)) as ApiErrorBody | null;
          const code = body?.error?.code;
          if (isKnownErrorCode(code)) {
            throw new SessionError(toAppError(code, body?.error?.message));
          }
          throw new SessionError(toAppError("session_create_failed"));
        }
        const session = (await sessionResponse.json()) as SessionResponse;
        engineRef.current = session.voiceEngine ?? "openai_realtime";
        const gateCfg = session.audioGate ?? null;
        gateEnabledRef.current = gateCfg?.enabled ?? false;
        setAudioGateConfig(gateCfg);
        memoryEnabledRef.current = session.memory?.enabled ?? false;
        memoryAutoSaveRef.current = session.memory?.autoSave ?? false;
        setMemoryEnabled(memoryEnabledRef.current);
        setSessionInfo({
          model: session.model,
          voice: session.voice,
          agentName: session.agentName,
          engine: engineRef.current,
        });

        // 2) Micrófono (se reutiliza en reconexiones si sigue vivo).
        //    AGC desactivado por defecto: no amplificar ruido de fondo.
        let stream = micStreamRef.current;
        const streamAlive = stream?.getAudioTracks().some((t) => t.readyState === "live") ?? false;
        if (!stream || !streamAlive) {
          setStatus("requesting_mic");
          statusRef.current = "requesting_mic";
          const requested = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: gateCfg?.autoGainControl ?? false,
          };
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: { ...requested, channelCount: 1 },
            });
          } catch (mediaError) {
            const name = mediaError instanceof DOMException ? mediaError.name : "";
            if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
              throw new SessionError(toAppError("mic_permission"));
            }
            if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
              throw new SessionError(toAppError("mic_unavailable"));
            }
            throw new SessionError(toAppError("unknown", "No se pudo acceder al micrófono."));
          }
          micStreamRef.current = stream;
          setMicStream(stream);
          // Diagnóstico: constraints pedidas vs realmente aplicadas.
          const track = stream.getAudioTracks()[0];
          const applied = track?.getSettings() ?? {};
          setMicSettings({
            deviceLabel: track?.label || "desconocido",
            requested,
            applied: {
              echoCancellation: applied.echoCancellation ?? null,
              noiseSuppression: applied.noiseSuppression ?? null,
              autoGainControl: applied.autoGainControl ?? null,
              sampleRate: applied.sampleRate ?? null,
            },
          });
        }

        // 3) WebRTC hacia OpenAI con el token efímero.
        setStatus("connecting");
        statusRef.current = "connecting";
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (pcRef.current !== pc) return;
          setConnectionState(pc.connectionState);
          if (pc.connectionState === "connected" && connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
          }
          if (pc.connectionState === "failed") {
            scheduleReconnectRef.current();
          }
          if (pc.connectionState === "disconnected") {
            setTimeout(() => {
              if (pcRef.current === pc && pc.connectionState === "disconnected") {
                scheduleReconnectRef.current();
              }
            }, DISCONNECT_GRACE_MS);
          }
        };

        pc.ontrack = (trackEvent) => {
          if (pcRef.current !== pc) return;
          const remote = trackEvent.streams[0] ?? new MediaStream([trackEvent.track]);
          setAgentStream(remote);
          const element = ensureAudioElement();
          element.srcObject = remote;
          void element.play().catch(() => {
            setError(toAppError("audio_playback"));
          });
        };

        // Al modelo viaja un CLON gateado; el original queda para análisis.
        const sourceTrack = stream.getAudioTracks()[0];
        if (!sourceTrack) {
          throw new SessionError(toAppError("mic_unavailable"));
        }
        const senderTrack = sourceTrack.clone();
        sendTrackRef.current = senderTrack;
        pc.addTrack(senderTrack, new MediaStream([senderTrack]));
        updateSendEnabled();

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onopen = () => {
          if (dcRef.current !== dc) return;
          setDataChannelState("open");
          reconnectAttemptsRef.current = 0;
          const ready = deriveReadyStatus();
          statusRef.current = ready;
          setStatus(ready);
          logRef.current.addSystem(
            isReconnect
              ? "Reconectado. Puedes seguir hablando."
              : gateEnabledRef.current && listenModeRef.current === "auto"
                ? `Sesión de voz iniciada con ${session.agentName}. Calibrando el ruido ambiente…`
                : `Sesión de voz iniciada con ${session.agentName}.`,
          );
        };
        dc.onmessage = (messageEvent) => handleServerEvent(String(messageEvent.data));
        dc.onclose = () => {
          if (dcRef.current !== dc) return;
          setDataChannelState("closed");
          scheduleReconnectRef.current();
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // El modelo y la configuración viajan dentro del token efímero:
        // /v1/realtime/calls no necesita parámetros adicionales.
        const sdpResponse = await fetch(`${session.baseUrl}/v1/realtime/calls`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
          signal: requestTimeoutSignal(15000),
        });
        if (!sdpResponse.ok) {
          throw new SessionError(
            toAppError("webrtc_failed", "OpenAI rechazó la conexión de audio en tiempo real."),
          );
        }
        const answerSdp = await sdpResponse.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        connectTimeoutRef.current = setTimeout(() => {
          if (pcRef.current === pc && pc.connectionState !== "connected") {
            cleanupPeer(true);
            setError(toAppError("webrtc_failed"));
            setStatus("error");
            statusRef.current = "error";
          }
        }, CONNECT_TIMEOUT_MS);
      } catch (caught) {
        cleanupPeer(true);
        const appError = mapCaughtError(caught);
        // En reconexiones, los fallos transitorios reprograman el siguiente
        // intento (backoff) en lugar de rendirse al primer error.
        if (
          isReconnect &&
          !intentionalCloseRef.current &&
          RETRYABLE_ON_RECONNECT.has(appError.code) &&
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          connectingRef.current = false;
          scheduleReconnectRef.current();
          return;
        }
        setError(appError);
        setStatus("error");
        statusRef.current = "error";
      } finally {
        connectingRef.current = false;
      }
    },
    [cleanupPeer, deriveReadyStatus, ensureAudioElement, handleServerEvent, updateSendEnabled],
  );

  const scheduleReconnect = useCallback(() => {
    if (intentionalCloseRef.current) return;
    if (reconnectTimerRef.current) return;
    if (connectingRef.current) return;

    cleanupPeer(true);

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatus("reconnecting");
      statusRef.current = "reconnecting";
      setError(toAppError("network_offline"));
      return; // el listener de 'online' reintentará
    }

    const attempt = reconnectAttemptsRef.current;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setStatus("error");
      statusRef.current = "error";
      setError(toAppError("webrtc_failed", undefined, "Pulsa «Conectar» para intentarlo de nuevo."));
      return;
    }
    reconnectAttemptsRef.current = attempt + 1;
    setStatus("reconnecting");
    statusRef.current = "reconnecting";
    if (attempt === 0) logRef.current.addSystem("Conexión perdida. Reintentando…");

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectInternal(true);
    }, 800 * 2 ** attempt);
  }, [cleanupPeer, connectInternal]);

  scheduleReconnectRef.current = scheduleReconnect;

  const connect = useCallback(async () => {
    reconnectAttemptsRef.current = 0;
    await connectInternal(false);
  }, [connectInternal]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    // Último barrido del curador antes de cerrar (si hay algo pendiente).
    void maybeExtractMemory(true);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    const wasActive = pcRef.current !== null || statusRef.current !== "idle";
    cleanupPeer(false);
    setStatus("idle");
    statusRef.current = "idle";
    setLatencyMs(null);
    if (wasActive) logRef.current.addSystem("Sesión finalizada.");
  }, [cleanupPeer, maybeExtractMemory]);

  const restart = useCallback(async () => {
    disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await connect();
  }, [connect, disconnect]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      updateSendEnabled();
      applyReadyStatus();
      return next;
    });
  }, [applyReadyStatus, updateSendEnabled]);

  const stopSpeaking = useCallback(() => {
    cancelActiveResponse();
    if (statusRef.current === "speaking" || statusRef.current === "thinking") {
      setStatusSafe(deriveReadyStatus());
    }
  }, [cancelActiveResponse, deriveReadyStatus, setStatusSafe]);

  const sendText = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      // Escribir equivale a interrumpir: si el agente está respondiendo,
      // se cancela la respuesta activa antes de pedir una nueva.
      if (statusRef.current === "speaking" || statusRef.current === "thinking") {
        cancelActiveResponse();
      }
      const created = sendEvent({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
      });
      if (!created) return false;
      sendEvent({ type: "response.create" });
      recordExchange("user", trimmed);
      void maybeInjectMemories(trimmed);
      return true;
    },
    [cancelActiveResponse, maybeInjectMemories, recordExchange, sendEvent],
  );

  const resumeAudio = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;
    void element
      .play()
      .then(() => {
        setError((current) => (current?.code === "audio_playback" ? null : current));
      })
      .catch(() => {
        setError(toAppError("audio_playback"));
      });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const setListenMode = useCallback(
    (mode: ListenMode) => {
      listenModeRef.current = mode;
      setListenModeState(mode);
      if (mode === "auto") {
        pttActiveRef.current = false;
        setPttActiveState(false);
      }
      updateSendEnabled();
      applyReadyStatus();
      if (CONNECTED_STATUSES.has(statusRef.current)) {
        logRef.current.addSystem(
          mode === "ptt"
            ? "Modo pulsar para hablar: mantén pulsado el botón del micrófono para hablar."
            : "Modo de escucha automática activado.",
        );
      }
    },
    [applyReadyStatus, updateSendEnabled],
  );

  const setPttActive = useCallback(
    (active: boolean) => {
      if (listenModeRef.current !== "ptt") return;
      pttActiveRef.current = active;
      setPttActiveState(active);
      updateSendEnabled();
      applyReadyStatus();
    },
    [applyReadyStatus, updateSendEnabled],
  );

  const calibrateAmbient = useCallback(() => {
    gateHook.calibrate();
    gateStateRef.current = "calibrating";
    applyReadyStatus();
  }, [applyReadyStatus, gateHook]);

  const extractMemoryNow = useCallback(async () => {
    await maybeExtractMemory(true);
  }, [maybeExtractMemory]);

  /** Interruptor local de memoria (el maestro es MEMORY_ENABLED en servidor). */
  const setMemoryActive = useCallback((active: boolean) => {
    memoryActiveRef.current = active;
    setMemoryActiveState(active);
  }, []);

  // Red: reflejar caídas y reconectar al volver la conexión.
  useEffect(() => {
    const handleOffline = () => {
      if (pcRef.current || reconnectTimerRef.current) {
        setError(toAppError("network_offline"));
        setStatus("reconnecting");
        statusRef.current = "reconnecting";
      }
    };
    const handleOnline = () => {
      if (intentionalCloseRef.current) return;
      if (statusRef.current === "reconnecting" && !pcRef.current && !connectingRef.current) {
        setError(null);
        reconnectAttemptsRef.current = 0;
        void connectInternal(true);
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [connectInternal]);

  // Limpieza total al desmontar.
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      dcRef.current?.close();
      pcRef.current?.close();
      sendTrackRef.current?.stop();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }
      if (ttsUrlRef.current) URL.revokeObjectURL(ttsUrlRef.current);
    };
  }, []);

  const isConnected = CONNECTED_STATUSES.has(status);

  const gate: GateDiagnostics = useMemo(
    () => ({
      state: gateHook.gateState,
      noiseFloor: gateHook.noiseFloor,
      threshold: gateHook.threshold,
      blockedNoises: gateHook.blockedNoises,
      level: gateHook.level,
    }),
    [gateHook.gateState, gateHook.noiseFloor, gateHook.threshold, gateHook.blockedNoises, gateHook.level],
  );

  return useMemo(
    () => ({
      status,
      error,
      isConnected,
      muted,
      latencyMs,
      eventCount,
      sessionInfo,
      micStream,
      agentStream,
      connectionState,
      dataChannelState,
      micSettings,
      listenMode,
      pttActive,
      gate,
      memoryEnabled,
      memoryActive,
      lastRecall,
      memorySavedCount,
      connect,
      disconnect,
      restart,
      toggleMute,
      stopSpeaking,
      sendText,
      resumeAudio,
      clearError,
      setListenMode,
      setPttActive,
      calibrateAmbient,
      extractMemoryNow,
      setMemoryActive,
    }),
    [
      status,
      error,
      isConnected,
      muted,
      latencyMs,
      eventCount,
      sessionInfo,
      micStream,
      agentStream,
      connectionState,
      dataChannelState,
      micSettings,
      listenMode,
      pttActive,
      gate,
      memoryEnabled,
      memoryActive,
      lastRecall,
      memorySavedCount,
      connect,
      disconnect,
      restart,
      toggleMute,
      stopSpeaking,
      sendText,
      resumeAudio,
      clearError,
      setListenMode,
      setPttActive,
      calibrateAmbient,
      extractMemoryNow,
      setMemoryActive,
    ],
  );
}
