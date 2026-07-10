"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { AgentStatus } from "@/lib/shared/types";

/**
 * El orbe de Helion: una aurora viva contenida en una esfera, dibujada en
 * canvas 2D sin dependencias. Manchas de luz orbitando con mezcla aditiva,
 * halo exterior, brillo especular y respiración orgánica. Los niveles de
 * audio llegan por refs (sin re-renders) y el estado modula paleta,
 * energía, velocidad y tamaño.
 */

interface OrbState {
  /** Dos tonos base (grados HSL) entre los que viven las luces. */
  hues: [number, number];
  /** Energía base 0..1 (luminosidad/halo). */
  energy: number;
  /** Velocidad del flujo interno. */
  speed: number;
  /** Escala del orbe (apagado = pequeño y dormido). */
  scale: number;
  /** Amplitud del pulso respiratorio. */
  pulse: number;
}

const ORB_STATES: Record<string, OrbState> = {
  idle: { hues: [218, 255], energy: 0.05, speed: 0.3, scale: 0.78, pulse: 0.02 },
  requesting_mic: { hues: [212, 258], energy: 0.16, speed: 0.55, scale: 0.86, pulse: 0.08 },
  connecting: { hues: [212, 258], energy: 0.16, speed: 0.55, scale: 0.86, pulse: 0.08 },
  calibrating: { hues: [188, 235], energy: 0.22, speed: 0.75, scale: 0.9, pulse: 0.1 },
  standby: { hues: [215, 268], energy: 0.13, speed: 0.45, scale: 0.92, pulse: 0.04 },
  voice_detected: { hues: [196, 242], energy: 0.3, speed: 1.0, scale: 0.96, pulse: 0.06 },
  listening: { hues: [186, 225], energy: 0.38, speed: 1.2, scale: 1, pulse: 0.05 },
  thinking: { hues: [262, 300], energy: 0.4, speed: 2.1, scale: 0.97, pulse: 0.12 },
  speaking: { hues: [278, 318], energy: 0.46, speed: 1.35, scale: 1, pulse: 0.06 },
  reconnecting: { hues: [38, 58], energy: 0.2, speed: 0.85, scale: 0.9, pulse: 0.12 },
  error: { hues: [8, 32], energy: 0.15, speed: 0.35, scale: 0.84, pulse: 0.05 },
};

function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export default function HelionOrb({
  status,
  micLevelRef,
  agentLevelRef,
}: {
  status: AgentStatus;
  micLevelRef: RefObject<number>;
  agentLevelRef: RefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<AgentStatus>(status);
  statusRef.current = status;
  // Suavizado persistente entre re-ejecuciones del efecto (sin saltos).
  const smoothRef = useRef({ energy: 0.05, scale: 0.78, hueA: 218, hueB: 255, level: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;
    let alive = true;
    const smooth = smoothRef.current;

    const draw = (timestamp: number) => {
      if (!alive) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas.clientWidth;
      if (size === 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size, size);

      const t = timestamp / 1000;
      const current = statusRef.current;
      const state = ORB_STATES[current] ?? ORB_STATES.idle;

      // Nivel de audio según estado (voz del usuario o del agente).
      let targetLevel = 0;
      if (current === "listening") targetLevel = micLevelRef.current ?? 0;
      else if (current === "voice_detected") targetLevel = (micLevelRef.current ?? 0) * 0.6;
      else if (current === "speaking")
        targetLevel = Math.max(agentLevelRef.current ?? 0, 0.12 + 0.1 * Math.sin(t * 3.6));
      smooth.level = lerp(smooth.level, Math.min(1, targetLevel), 0.2);
      const level = smooth.level;

      const breathe = state.pulse * Math.sin(t * (current === "thinking" ? 3.4 : 1.7));
      smooth.energy = lerp(smooth.energy, Math.min(1, state.energy + level * 0.55 + breathe), 0.08);
      smooth.scale = lerp(smooth.scale, state.scale, 0.06);
      smooth.hueA = lerp(smooth.hueA, state.hues[0], 0.05);
      smooth.hueB = lerp(smooth.hueB, state.hues[1], 0.05);
      const { energy, scale, hueA, hueB } = smooth;

      const cx = size / 2;
      const cy = size / 2;
      const radius = size * 0.34 * scale * (1 + level * 0.04);

      // Halo exterior.
      const haloRadius = radius * (1.45 + energy * 0.8);
      const halo = context.createRadialGradient(cx, cy, radius * 0.6, cx, cy, haloRadius);
      halo.addColorStop(0, `hsla(${hueA}, 90%, 62%, ${0.1 + energy * 0.22})`);
      halo.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      context.fill();

      // Esfera base: profundidad oscura.
      const base = context.createRadialGradient(
        cx - radius * 0.25,
        cy - radius * 0.3,
        radius * 0.1,
        cx,
        cy,
        radius,
      );
      base.addColorStop(0, "hsla(228, 45%, 16%, 1)");
      base.addColorStop(0.7, "hsla(232, 50%, 8%, 1)");
      base.addColorStop(1, "hsla(235, 55%, 4%, 1)");
      context.fillStyle = base;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();

      // Aurora interior: manchas de luz orbitando con mezcla aditiva.
      context.save();
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.clip();
      context.globalCompositeOperation = "lighter";

      const speed = state.speed;
      for (let i = 0; i < 4; i++) {
        const phase = (i * Math.PI) / 2;
        const wander = Math.sin(t * 0.6 * speed + i * 1.7);
        const angle = t * speed * (0.35 + i * 0.13) + phase;
        const dist = radius * (0.22 + 0.16 * wander + level * 0.12);
        const bx = cx + Math.cos(angle) * dist;
        const by = cy + Math.sin(angle * 0.9) * dist;
        const blobRadius = radius * (0.5 + 0.16 * Math.sin(t * 0.8 * speed + i * 2.3));
        const hue = (i % 2 === 0 ? hueA : hueB) + 14 * Math.sin(t * 0.5 + i);
        const alpha = 0.16 + energy * 0.4;

        const blob = context.createRadialGradient(bx, by, 0, bx, by, blobRadius);
        blob.addColorStop(0, `hsla(${hue}, 88%, 64%, ${alpha})`);
        blob.addColorStop(0.6, `hsla(${hue + 18}, 85%, 55%, ${alpha * 0.4})`);
        blob.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        context.fillStyle = blob;
        context.beginPath();
        context.arc(bx, by, blobRadius, 0, Math.PI * 2);
        context.fill();
      }

      // Núcleo luminoso tenue.
      const core = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.55);
      core.addColorStop(0, `hsla(0, 0%, 100%, ${0.05 + energy * 0.16})`);
      core.addColorStop(1, "hsla(0, 0%, 100%, 0)");
      context.fillStyle = core;
      context.beginPath();
      context.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
      context.fill();

      context.restore();

      // Brillo especular arriba-izquierda (sensación de esfera pulida).
      const spec = context.createRadialGradient(
        cx - radius * 0.4,
        cy - radius * 0.48,
        0,
        cx - radius * 0.4,
        cy - radius * 0.48,
        radius * 0.5,
      );
      spec.addColorStop(0, "hsla(0, 0%, 100%, 0.14)");
      spec.addColorStop(1, "hsla(0, 0%, 100%, 0)");
      context.fillStyle = spec;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();

      // Anillo fino del borde.
      context.strokeStyle = `hsla(${hueA}, 75%, 72%, ${0.18 + energy * 0.3})`;
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(cx, cy, radius + 0.5, 0, Math.PI * 2);
      context.stroke();

      if (!reduceMotion) {
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
    // Con reduce-motion se redibuja un frame estático por cambio de estado.
  }, [micLevelRef, agentLevelRef, status]);

  return (
    <div className="orb-wrap" data-status={status}>
      <canvas ref={canvasRef} className="orb-canvas" aria-hidden />
    </div>
  );
}
