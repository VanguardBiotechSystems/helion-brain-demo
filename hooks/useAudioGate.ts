"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioGateEngine,
  DEFAULT_GATE_CONFIG,
  rmsFromTimeDomain,
  type GateSnapshot,
  type GateState,
} from "@/lib/audio/gateEngine";
import type { ClientGateConfig } from "@/lib/shared/types";

/**
 * Cableado Web Audio del gate local: analiza el stream ORIGINAL del
 * micrófono (que nunca sale del navegador) a ~50 Hz y alimenta el motor
 * puro AudioGateEngine. El estado para la UI se actualiza con throttle
 * para no re-renderizar a 50 fps.
 */

const POLL_MS = 20;
const UI_THROTTLE_MS = 200;

export interface AudioGateHook {
  /** Estado del gate ("off" si está desactivado o sin stream). */
  gateState: GateState | "off";
  open: boolean;
  noiseFloor: number;
  threshold: number;
  blockedNoises: number;
  level: number;
  calibrate(): void;
}

export function useAudioGate(
  stream: MediaStream | null,
  config: ClientGateConfig | null,
  active: boolean,
  onOpenChange: (open: boolean) => void,
): AudioGateHook {
  const [snapshot, setSnapshot] = useState<GateSnapshot | null>(null);
  const engineRef = useRef<AudioGateEngine | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const enabled = active && config !== null && config.enabled && stream !== null;

  useEffect(() => {
    if (!enabled || !stream || !config) {
      engineRef.current = null;
      setSnapshot(null);
      return;
    }

    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor = window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
    if (!AudioContextCtor) return;

    const engine = new AudioGateEngine({
      ...DEFAULT_GATE_CONFIG,
      calibrationMs: config.calibrationMs,
      minSpeechMs: config.minSpeechMs,
      spikeRejectionMs: config.spikeRejectionMs,
      thresholdMultiplier: config.thresholdMultiplier,
    });
    engine.calibrate(performance.now());
    engineRef.current = engine;

    let context: AudioContext;
    let source: MediaStreamAudioSourceNode | null = null;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let lastOpen = false;
    let lastUiUpdate = 0;

    try {
      context = new AudioContextCtor();
      source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      // Suavizado bajo: los huecos entre teclas no deben difuminarse.
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      intervalId = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        const now = performance.now();
        const snap = engine.process(now, rmsFromTimeDomain(data));
        // La pista se abre con sendOpen (pre-apertura en candidate) para no
        // perder el inicio de la frase; la UI "Escuchando" usa snap.state.
        if (snap.sendOpen !== lastOpen) {
          lastOpen = snap.sendOpen;
          onOpenChangeRef.current(snap.sendOpen);
        }
        if (now - lastUiUpdate >= UI_THROTTLE_MS) {
          lastUiUpdate = now;
          setSnapshot(snap);
        }
      }, POLL_MS);

      if (context.state === "suspended") void context.resume().catch(() => {});
    } catch {
      return;
    }

    return () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      try {
        source?.disconnect();
      } catch {
        // ya desconectado
      }
      void context.close().catch(() => {});
      if (lastOpen) onOpenChangeRef.current(false);
      engineRef.current = null;
    };
    // config se compara por sus valores primitivos para no recrear en cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    stream,
    config?.enabled,
    config?.calibrationMs,
    config?.minSpeechMs,
    config?.spikeRejectionMs,
    config?.thresholdMultiplier,
  ]);

  const calibrate = useCallback(() => {
    engineRef.current?.calibrate(performance.now());
  }, []);

  return {
    gateState: enabled && snapshot ? snapshot.state : "off",
    open: snapshot?.sendOpen ?? false,
    noiseFloor: snapshot?.noiseFloor ?? 0,
    threshold: snapshot?.threshold ?? 0,
    blockedNoises: snapshot?.blockedNoises ?? 0,
    level: snapshot?.level ?? 0,
    calibrate,
  };
}
