"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { AgentStatus } from "@/lib/shared/types";

/**
 * Orbe central animado por canvas. Lee los niveles de audio desde refs
 * (sin estado React) para animar a 60 fps sin re-renderizar la página.
 */

interface Palette {
  core: string;
  glow: string;
  ring: string;
}

const PALETTES: Record<string, Palette> = {
  idle: { core: "#3a4a63", glow: "rgba(90,120,170,0.25)", ring: "rgba(120,150,200,0.35)" },
  requesting_mic: { core: "#4a5d7d", glow: "rgba(90,140,200,0.3)", ring: "rgba(120,170,230,0.45)" },
  connecting: { core: "#4a5d7d", glow: "rgba(90,140,200,0.3)", ring: "rgba(120,170,230,0.45)" },
  listening: { core: "#39c8e8", glow: "rgba(70,205,235,0.45)", ring: "rgba(90,215,255,0.7)" },
  thinking: { core: "#e8b45a", glow: "rgba(255,196,107,0.4)", ring: "rgba(255,196,107,0.65)" },
  speaking: { core: "#8b7cf7", glow: "rgba(139,124,247,0.5)", ring: "rgba(160,145,255,0.75)" },
  reconnecting: { core: "#e8935a", glow: "rgba(255,150,90,0.4)", ring: "rgba(255,160,100,0.6)" },
  error: { core: "#c85868", glow: "rgba(255,107,122,0.4)", ring: "rgba(255,107,122,0.6)" },
};

const BAR_COUNT = 72;

export default function MicLevelVisualizer({
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let rafId = 0;
    let alive = true;
    let smoothLevel = 0;

    const draw = (timestamp: number) => {
      if (!alive) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas.clientWidth;
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size, size);

      const current = statusRef.current;
      const palette = PALETTES[current] ?? PALETTES.idle;
      const t = timestamp / 1000;
      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = size * 0.27;

      // Nivel objetivo según estado.
      let target = 0;
      if (current === "listening") target = micLevelRef.current ?? 0;
      else if (current === "speaking") target = agentLevelRef.current ?? 0;
      else if (current === "thinking") target = 0.25 + 0.2 * Math.sin(t * 3.1);
      else if (current === "connecting" || current === "requesting_mic" || current === "reconnecting")
        target = 0.15 + 0.12 * Math.sin(t * 2.2);
      smoothLevel += (target - smoothLevel) * 0.18;
      const level = Math.max(0, Math.min(1, smoothLevel));

      // Halo exterior.
      const haloRadius = baseRadius * (1.35 + level * 0.5);
      const halo = context.createRadialGradient(cx, cy, baseRadius * 0.4, cx, cy, haloRadius);
      halo.addColorStop(0, palette.glow);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      context.fill();

      // Barras radiales orgánicas.
      context.strokeStyle = palette.ring;
      context.lineWidth = 2;
      context.lineCap = "round";
      const inner = baseRadius * 1.08;
      for (let i = 0; i < BAR_COUNT; i++) {
        const angle = (i / BAR_COUNT) * Math.PI * 2;
        const wobble = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(i * 0.9 + t * 2.4);
        const length = 3 + baseRadius * 0.34 * level * wobble;
        const x1 = cx + Math.cos(angle) * inner;
        const y1 = cy + Math.sin(angle) * inner;
        const x2 = cx + Math.cos(angle) * (inner + length);
        const y2 = cy + Math.sin(angle) * (inner + length);
        context.globalAlpha = 0.35 + 0.65 * wobble * level;
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
      }
      context.globalAlpha = 1;

      // Orbe central.
      const orbRadius = baseRadius * (1 + (reduceMotion ? 0 : level * 0.06));
      const orb = context.createRadialGradient(
        cx - orbRadius * 0.3,
        cy - orbRadius * 0.35,
        orbRadius * 0.1,
        cx,
        cy,
        orbRadius,
      );
      orb.addColorStop(0, "rgba(240,248,255,0.95)");
      orb.addColorStop(0.25, palette.core);
      orb.addColorStop(1, "rgba(5,8,14,0.9)");
      context.fillStyle = orb;
      context.beginPath();
      context.arc(cx, cy, orbRadius, 0, Math.PI * 2);
      context.fill();

      // Anillo del orbe.
      context.strokeStyle = palette.ring;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(cx, cy, orbRadius + 1, 0, Math.PI * 2);
      context.stroke();

      // Anillo giratorio en estados de transición.
      if (!reduceMotion && (current === "connecting" || current === "reconnecting" || current === "requesting_mic")) {
        context.strokeStyle = palette.ring;
        context.lineWidth = 2.5;
        context.beginPath();
        context.arc(cx, cy, orbRadius + 12, t * 2.6, t * 2.6 + Math.PI * 0.6);
        context.stroke();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [micLevelRef, agentLevelRef]);

  return (
    <div className="orb-wrap" data-status={status}>
      <canvas ref={canvasRef} className="orb-canvas" aria-hidden />
    </div>
  );
}
