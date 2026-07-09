"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TranscriptEntry } from "@/lib/shared/types";
import { RobotIcon, SendIcon } from "./Icons";

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  connected: boolean;
  sending: boolean;
  onSendText: (text: string) => void | Promise<void>;
}

function Bubble({ entry }: { entry: TranscriptEntry }) {
  if (entry.role === "system") {
    return <div className="t-system">{entry.text}</div>;
  }
  if (entry.role === "action") {
    return (
      <div className={`t-action ${entry.action?.status === "rejected" ? "t-action-rejected" : ""}`}>
        <RobotIcon size={16} className="t-action-icon" />
        <div>
          <div className="t-action-head">
            Acción simulada · <code>{entry.action?.command}</code>
            <span className="t-action-badge">SIN HARDWARE</span>
          </div>
          {entry.text && <div className="t-action-detail">{entry.text}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className={`t-bubble ${entry.role === "user" ? "t-user" : "t-agent"} ${entry.pending ? "t-pending" : ""}`}>
      {entry.text || "…"}
    </div>
  );
}

/**
 * Panel de subtítulos/transcripción + entrada de texto.
 * El texto usa la misma sesión de voz si está conectada; si no,
 * la página cae al endpoint /api/chat (modo fallback).
 */
export default function TranscriptPanel({
  entries,
  connected,
  sending,
  onSendText,
}: TranscriptPanelProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await onSendText(text);
  }

  return (
    <aside className="transcript-panel">
      <div className="transcript-head">
        <h2>Conversación</h2>
        <span className="transcript-hint">solo en este navegador · no se guarda</span>
      </div>

      <div className="transcript-scroll" ref={scrollRef}>
        {entries.length === 0 ? (
          <p className="transcript-empty">
            Pulsa «Conectar cerebro» y habla con naturalidad. Aquí verás los subtítulos de la
            conversación y las acciones simuladas del robot.
          </p>
        ) : (
          entries.map((entry) => <Bubble key={entry.id} entry={entry} />)
        )}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          className="composer-input"
          type="text"
          placeholder={connected ? "También puedes escribirle…" : "Modo texto (sin micrófono)…"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={sending}
          maxLength={2000}
        />
        <button
          className="icon-btn composer-send"
          type="submit"
          disabled={sending || draft.trim().length === 0}
          aria-label="Enviar mensaje"
          title="Enviar mensaje"
        >
          <SendIcon />
        </button>
      </form>
      {!connected && (
        <p className="composer-note">
          Sin conexión de voz: el mensaje se responderá por escrito (modo fallback).
        </p>
      )}
    </aside>
  );
}
