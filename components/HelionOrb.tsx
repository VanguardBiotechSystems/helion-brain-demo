"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { AgentStatus } from "@/lib/shared/types";

/**
 * El orbe de Helion: una esfera de luz viva, sobria y contenida.
 *
 * Arquitectura visual en dos capas independientes:
 * - Halo exterior: capa CSS (.orb-halo) DETRÁS del canvas — deliberado,
 *   sutil y con transición por estado. Al ser una capa separada, es
 *   imposible que el contenido interno "se fugue" de la esfera.
 * - Esfera: canvas 2D con clipping real (arc + clip). Todo lo interno —
 *   auroras, velos, núcleo — vive dentro del círculo. Pintado por capas:
 *   base oscura → auroras de deriva orgánica → núcleo → oclusión inferior
 *   → anillo fresnel → brillo especular → borde fino.
 *
 * El movimiento usa sumas de senos con frecuencias inconmensurables (nada
 * de órbitas evidentes) y toda la energía está interpolada: Helion respira.
 */

interface OrbState {
  /** Dos tonos base (grados HSL) de las auroras internas. */
  hues: [number, number];
  /** Saturación de las luces (contenida; el error baja aún más). */
  sat: number;
  /** Energía base 0..1 (luminosidad interna). */
  energy: number;
  /** Velocidad del flujo interno. */
  speed: number;
  /** Escala de la esfera (apagado = más pequeña, dormida). */
  scale: number;
  /** Amplitud de la respiración. */
  pulse: number;
  /** Concentración de las corrientes hacia el centro (pensando < 1). */
  pull: number;
  /** Intensidad del halo exterior CSS 0..1. */
  halo: number;
}

// Paleta por estado: azul = espera/escucha, amarillo = pensando,
// verde = hablando, rojo = error, y "party" (casi blanco, sat mínima)
// como modo especial activado a mano — ver handlePartyGesture más abajo.
const ORB_STATES: Record<string, OrbState> = {
  idle: { hues: [208, 226], sat: 58, energy: 0.06, speed: 0.25, scale: 0.8, pulse: 0.015, pull: 1, halo: 0.16 },
  requesting_mic: { hues: [206, 224], sat: 64, energy: 0.15, speed: 0.5, scale: 0.87, pulse: 0.06, pull: 0.9, halo: 0.32 },
  connecting: { hues: [206, 224], sat: 64, energy: 0.15, speed: 0.5, scale: 0.87, pulse: 0.06, pull: 0.9, halo: 0.32 },
  calibrating: { hues: [202, 222], sat: 62, energy: 0.2, speed: 0.6, scale: 0.9, pulse: 0.07, pull: 1, halo: 0.38 },
  standby: { hues: [206, 224], sat: 60, energy: 0.12, speed: 0.34, scale: 0.93, pulse: 0.028, pull: 1, halo: 0.3 },
  voice_detected: { hues: [200, 220], sat: 66, energy: 0.26, speed: 0.68, scale: 0.96, pulse: 0.04, pull: 0.75, halo: 0.46 },
  listening: { hues: [198, 218], sat: 68, energy: 0.34, speed: 0.8, scale: 1, pulse: 0.035, pull: 0.85, halo: 0.6 },
  thinking: { hues: [45, 58], sat: 72, energy: 0.34, speed: 1.55, scale: 0.97, pulse: 0.07, pull: 0.55, halo: 0.5 },
  speaking: { hues: [130, 155], sat: 62, energy: 0.38, speed: 1.0, scale: 1, pulse: 0.05, pull: 0.8, halo: 0.62 },
  reconnecting: { hues: [210, 230], sat: 56, energy: 0.15, speed: 0.65, scale: 0.9, pulse: 0.09, pull: 1, halo: 0.32 },
  error: { hues: [355, 10], sat: 60, energy: 0.14, speed: 0.28, scale: 0.85, pulse: 0.04, pull: 1, halo: 0.3 },
  party: { hues: [0, 40], sat: 6, energy: 0.42, speed: 0.9, scale: 1.04, pulse: 0.09, pull: 0.6, halo: 0.75 },
};

function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/**
 * Deriva orgánica en [-1, 1]²: suma de senos con frecuencias
 * inconmensurables — fluye, no orbita.
 */
function drift(t: number, seed: number): { x: number; y: number } {
  return {
    x: 0.55 * Math.sin(t * 0.21 + seed * 1.7) + 0.45 * Math.sin(t * 0.093 + seed * 3.13),
    y: 0.55 * Math.cos(t * 0.17 + seed * 2.31) + 0.45 * Math.sin(t * 0.127 + seed * 4.73),
  };
}

export interface OrbPulse {
  kind: "heard" | "memory" | "identity";
  seq: number;
}

// El barrido de identidad dura más (un cierre/apertura de contexto) y se
// autocompleta aunque la sesión de proveedor tarde.
const PULSE_MS: Record<OrbPulse["kind"], number> = { heard: 450, memory: 450, identity: 900 };

export default function HelionOrb({
  status,
  micLevelRef,
  agentLevelRef,
  pulse = null,
  micUnavailable = false,
}: {
  status: AgentStatus;
  micLevelRef: RefObject<number>;
  agentLevelRef: RefObject<number>;
  /** Microestados perceptivos: "te he oído" (heard), recuerdo (memory), cambio de identidad. */
  pulse?: OrbPulse | null;
  /** Anillo ámbar tenue: mic denegado/muteado/perdido/no soportado (§12). */
  micUnavailable?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<AgentStatus>(status);
  statusRef.current = status;
  const micUnavailableRef = useRef(micUnavailable);
  micUnavailableRef.current = micUnavailable;

  // Modo "party" (blanco): estado especial activado a mano, no ligado a
  // ningún evento del backend. Gesto oculto: 4 clics rápidos (<1.5s) sobre
  // el propio orbe. Vuelve a repetirse el gesto para desactivarlo.
  const [party, setParty] = useState(false);
  const partyRef = useRef(false);
  partyRef.current = party;
  const partyClicksRef = useRef<number[]>([]);
  const handlePartyGesture = () => {
    const now = performance.now();
    const recent = partyClicksRef.current.filter((ts) => now - ts < 1500);
    recent.push(now);
    partyClicksRef.current = recent;
    if (recent.length >= 4) {
      partyClicksRef.current = [];
      setParty((current) => !current);
    }
  };
  // Suavizado persistente entre re-ejecuciones del efecto (sin saltos).
  const smoothRef = useRef({ energy: 0.05, scale: 0.8, hueA: 220, hueB: 254, sat: 62, pull: 1, level: 0 });
  // Pulso activo: {kind, startedAt} — se dibuja y se autocancela.
  const pulseRef = useRef<{ kind: OrbPulse["kind"]; startedAt: number } | null>(null);
  useEffect(() => {
    if (pulse) pulseRef.current = { kind: pulse.kind, startedAt: performance.now() };
  }, [pulse]);

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
      const state = partyRef.current ? ORB_STATES.party : (ORB_STATES[current] ?? ORB_STATES.idle);

      // Nivel de audio, siempre suavizado (nunca literal ni parpadeante).
      let targetLevel = 0;
      if (current === "listening") targetLevel = micLevelRef.current ?? 0;
      else if (current === "voice_detected") targetLevel = (micLevelRef.current ?? 0) * 0.5;
      else if (current === "speaking")
        targetLevel = Math.max(agentLevelRef.current ?? 0, 0.1 + 0.08 * Math.sin(t * 3.1));
      smooth.level = lerp(smooth.level, Math.min(1, targetLevel), 0.12);
      const level = smooth.level;

      const breathe = state.pulse * Math.sin(t * (current === "thinking" ? 2.9 : 1.4));
      smooth.energy = lerp(smooth.energy, Math.min(1, state.energy + level * 0.4 + breathe), 0.06);
      smooth.scale = lerp(smooth.scale, state.scale, 0.05);
      smooth.hueA = lerp(smooth.hueA, state.hues[0], 0.04);
      smooth.hueB = lerp(smooth.hueB, state.hues[1], 0.04);
      smooth.sat = lerp(smooth.sat, state.sat, 0.05);
      smooth.pull = lerp(smooth.pull, state.pull, 0.05);
      const { energy, scale, hueA, hueB, sat, pull } = smooth;

      const cx = size / 2;
      const cy = size / 2;
      // La esfera casi llena el canvas: el halo vive en su propia capa CSS.
      const radius = size * 0.46 * scale;

      // ── Interior de la esfera (todo bajo clipping real) ──────────────
      context.save();
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.clip();

      // 1) Base: vidrio oscuro con profundidad (más luz arriba-centro).
      const base = context.createRadialGradient(
        cx,
        cy - radius * 0.22,
        radius * 0.08,
        cx,
        cy,
        radius * 1.02,
      );
      base.addColorStop(0, "hsl(225, 42%, 13%)");
      base.addColorStop(0.55, "hsl(228, 48%, 7.5%)");
      base.addColorStop(1, "hsl(231, 52%, 4%)");
      context.fillStyle = base;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      // 2) Auroras: cinco masas de luz con deriva orgánica, alpha bajo.
      context.globalCompositeOperation = "lighter";
      const speed = state.speed;
      for (let i = 0; i < 5; i++) {
        const d = drift(t * speed, i + 1);
        // Alcances distintos por luz: unas viven cerca del centro y otras
        // se separan hacia el borde — aurora, no un foco único.
        const reach = radius * (0.24 + 0.14 * i * 0.25 + 0.1 * (i % 3)) * pull;
        const bx = cx + d.x * reach;
        const by = cy + d.y * reach * 0.85 + radius * 0.05;
        const blobRadius = radius * (0.42 + 0.14 * Math.sin(t * 0.11 * speed + i * 2.09) + i * 0.03);
        const hue = (i % 2 === 0 ? hueA : hueB) + 10 * Math.sin(t * 0.07 + i * 1.31);
        const alpha = 0.05 + energy * 0.15;

        const blob = context.createRadialGradient(bx, by, 0, bx, by, blobRadius);
        blob.addColorStop(0, `hsla(${hue}, ${sat}%, 60%, ${alpha})`);
        blob.addColorStop(0.4, `hsla(${hue + 8}, ${sat - 4}%, 55%, ${alpha * 0.55})`);
        blob.addColorStop(0.72, `hsla(${hue + 14}, ${sat - 8}%, 48%, ${alpha * 0.22})`);
        blob.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        context.fillStyle = blob;
        context.beginPath();
        context.arc(bx, by, blobRadius, 0, Math.PI * 2);
        context.fill();
      }

      // 3) Núcleo lechoso, apenas presente.
      const core = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.5);
      core.addColorStop(0, `hsla(210, 30%, 92%, ${0.02 + energy * 0.07})`);
      core.addColorStop(1, "hsla(0, 0%, 100%, 0)");
      context.fillStyle = core;
      context.beginPath();
      context.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
      context.fill();

      context.globalCompositeOperation = "source-over";

      // 4) Oclusión inferior: da volumen (la luz vive arriba).
      const occlusion = context.createRadialGradient(
        cx,
        cy + radius * 0.95,
        radius * 0.1,
        cx,
        cy + radius * 0.95,
        radius * 1.5,
      );
      occlusion.addColorStop(0, "hsla(230, 55%, 3%, 0.5)");
      occlusion.addColorStop(0.6, "hsla(230, 55%, 3%, 0.18)");
      occlusion.addColorStop(1, "hsla(230, 55%, 3%, 0)");
      context.fillStyle = occlusion;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      // 5) Anillo fresnel: la luz se acumula en el borde interno del vidrio.
      const fresnel = context.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius);
      fresnel.addColorStop(0, "hsla(0, 0%, 0%, 0)");
      fresnel.addColorStop(0.72, `hsla(${hueA}, ${sat - 12}%, 72%, ${0.03 + energy * 0.08})`);
      fresnel.addColorStop(0.95, `hsla(${hueB}, ${sat - 8}%, 68%, ${0.05 + energy * 0.11})`);
      fresnel.addColorStop(1, `hsla(${hueA}, ${sat}%, 75%, ${0.02 + energy * 0.05})`);
      context.fillStyle = fresnel;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      // 6) Brillo especular: casquete amplio y suave arriba — luz de vidrio,
      // no una mancha. Se atenúa cuando la esfera duerme.
      context.save();
      context.translate(cx - radius * 0.1, cy - radius * 0.62);
      context.rotate(-0.3);
      context.scale(1, 0.42);
      const spec = context.createRadialGradient(0, 0, 0, 0, 0, radius * 0.85);
      spec.addColorStop(0, `hsla(218, 45%, 94%, ${0.05 + energy * 0.11})`);
      spec.addColorStop(0.55, `hsla(218, 45%, 94%, ${0.015 + energy * 0.03})`);
      spec.addColorStop(1, "hsla(0, 0%, 100%, 0)");
      context.fillStyle = spec;
      context.beginPath();
      context.arc(0, 0, radius * 0.85, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.restore(); // fin del clipping: nada interno sale de aquí

      // 6b) Microestados perceptivos: recepción ("te he oído", cian),
      // recuerdo guardado (destello dorado) o cambio de identidad (barrido
      // violeta que cierra un contexto y abre otro). Nacen de eventos reales;
      // con reduce-motion no se anima.
      const activePulse = pulseRef.current;
      if (activePulse && !reduceMotion) {
        const age = (timestamp - activePulse.startedAt) / PULSE_MS[activePulse.kind];
        if (age >= 1) {
          pulseRef.current = null;
        } else {
          const fade = 1 - age;
          if (activePulse.kind === "heard") {
            context.strokeStyle = `hsla(196, 80%, 70%, ${0.35 * fade})`;
            context.lineWidth = 2;
            context.beginPath();
            context.arc(cx, cy, radius * (1.02 + age * 0.12), 0, Math.PI * 2);
            context.stroke();
          } else if (activePulse.kind === "memory") {
            const glow = context.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius);
            glow.addColorStop(0, `hsla(45, 85%, 62%, ${0.16 * fade})`);
            glow.addColorStop(1, "hsla(45, 85%, 62%, 0)");
            context.fillStyle = glow;
            context.beginPath();
            context.arc(cx, cy, radius, 0, Math.PI * 2);
            context.fill();
          } else {
            // Identidad: un arco de barrido gira una vuelta (cierra→abre).
            const sweep = age * Math.PI * 2;
            context.strokeStyle = `hsla(276, 70%, 74%, ${0.5 * (1 - Math.abs(age - 0.5) * 2)})`;
            context.lineWidth = 2.5;
            context.beginPath();
            context.arc(cx, cy, radius * 1.05, sweep - 0.9, sweep);
            context.stroke();
          }
        }
      }

      // 6c) Micrófono no disponible (§12): anillo ámbar tenue y estable, muy
      // distinto de un error cognitivo/red (que va en el banner). Siempre
      // visible (no depende de reduce-motion: no se anima).
      if (micUnavailableRef.current) {
        context.strokeStyle = "hsla(38, 90%, 60%, 0.5)";
        context.lineWidth = 2;
        context.setLineDash([radius * 0.16, radius * 0.1]);
        context.beginPath();
        context.arc(cx, cy, radius * 1.08, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
      }

      // 7) Borde óptico: un trazo fino, casi imperceptible.
      context.strokeStyle = `hsla(${hueA}, ${sat - 20}%, 80%, ${0.08 + energy * 0.14})`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
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
    // Con reduce-motion se redibuja un frame estático por cambio de estado
    // (incluye micUnavailable para que el anillo ámbar aparezca/desaparezca,
    // y party para que el modo blanco se refleje al instante).
  }, [micLevelRef, agentLevelRef, status, micUnavailable, party]);

  const state = party ? ORB_STATES.party : (ORB_STATES[status] ?? ORB_STATES.idle);
  const haloHue = (state.hues[0] + state.hues[1]) / 2;
  const haloStyle: CSSProperties = {
    opacity: state.halo,
    background: `radial-gradient(closest-side, hsla(${haloHue}, ${state.sat}%, 58%, 0.22), hsla(${haloHue}, ${state.sat}%, 50%, 0.05) 55%, transparent 74%)`,
  };

  return (
    <div
      className="orb-stage"
      data-status={status}
      data-party={party || undefined}
      onClick={handlePartyGesture}
    >
      <div className="orb-halo" style={haloStyle} aria-hidden />
      <canvas ref={canvasRef} className="orb-canvas" aria-hidden />
    </div>
  );
}
