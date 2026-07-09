"use client";

import type { AgentStatus } from "@/lib/shared/types";

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Desconectado",
  requesting_mic: "Solicitando micrófono…",
  connecting: "Conectando…",
  listening: "Escuchando",
  thinking: "Pensando…",
  speaking: "Hablando",
  reconnecting: "Reconectando…",
  error: "Error",
};

export function statusLabel(status: AgentStatus): string {
  return STATUS_LABEL[status];
}

export default function ConnectionStatus({
  status,
  muted,
}: {
  status: AgentStatus;
  muted: boolean;
}) {
  return (
    <div className="status-badge" data-status={status}>
      <span className="status-dot" aria-hidden />
      <span>{STATUS_LABEL[status]}</span>
      {muted && status !== "idle" && <span className="status-muted-tag">micro off</span>}
    </div>
  );
}
