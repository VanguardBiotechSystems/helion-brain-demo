"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Nivel de audio (0..1) de un MediaStream vía AnalyserNode.
 * Devuelve una ref actualizada por requestAnimationFrame en lugar de
 * estado React: así el visualizador anima a 60 fps sin re-renderizar
 * todo el árbol de componentes.
 */
export function useMicrophoneLevel(stream: MediaStream | null): RefObject<number> {
  const levelRef = useRef(0);

  useEffect(() => {
    levelRef.current = 0;
    if (!stream || stream.getAudioTracks().length === 0) return;

    type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor =
      typeof window !== "undefined"
        ? (window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext)
        : undefined;
    if (!AudioContextCtor) return;

    let context: AudioContext;
    let source: MediaStreamAudioSourceNode | null = null;
    let rafId = 0;
    let alive = true;

    try {
      context = new AudioContextCtor();
      source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!alive) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        levelRef.current = Math.min(1, rms * 3.5);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      if (context.state === "suspended") void context.resume().catch(() => {});
    } catch {
      // Sin analizador el orbe se anima solo por estado: no es fatal.
      return;
    }

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      try {
        source?.disconnect();
      } catch {
        // ya desconectado
      }
      void context.close().catch(() => {});
    };
  }, [stream]);

  return levelRef;
}
