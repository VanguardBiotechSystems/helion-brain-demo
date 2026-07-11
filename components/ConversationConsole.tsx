"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TranscriptEntry } from "@/lib/shared/types";
import { SendIcon } from "./Icons";

/**
 * Consola conversacional premium de Helion para la experiencia pública.
 * Colapsable, estética glass, minimal. Muestra lo que dijo el usuario, lo que
 * Helion respondió, y los turnos IGNORADOS (mención/fondo, marcados sutilmente).
 * Incluye entrada de texto como fallback del micrófono. No es un chat genérico:
 * es la consola de control de Helion.
 */
interface ConversationConsoleProps {
  entries: TranscriptEntry[];
  connected: boolean;
  sending: boolean;
  onSendText: (text: string) => void | Promise<void>;
  defaultOpen: boolean;
  showIgnored: boolean;
  textInputEnabled: boolean;
}

function timeLabel(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Row({ entry, showIgnored }: { entry: TranscriptEntry; showIgnored: boolean }) {
  if (entry.role === "system") {
    return <p className="cc-system">{entry.text}</p>;
  }
  if (entry.role === "action") {
    return (
      <p className="cc-system cc-action">
        Acción simulada · <code>{entry.action?.command}</code> · SIN HARDWARE
      </p>
    );
  }
  if (entry.role === "user" && entry.ignored) {
    if (!showIgnored) return null;
    return (
      <div className="cc-row cc-row-user">
        <div className="cc-bubble cc-ignored" title={entry.note ?? "No dirigido a Helion"}>
          {entry.text}
          <span className="cc-note">{entry.note ?? "no dirigido a Helion"}</span>
        </div>
      </div>
    );
  }
  const isUser = entry.role === "user";
  return (
    <div className={`cc-row ${isUser ? "cc-row-user" : "cc-row-agent"}`}>
      <div className={`cc-bubble ${isUser ? "cc-user" : "cc-agent"} ${entry.pending ? "cc-pending" : ""}`}>
        {entry.text || "…"}
        {(isUser && entry.inputMode === "text") && <span className="cc-tag">escrito</span>}
        <span className="cc-time">{timeLabel(entry.at)}</span>
      </div>
    </div>
  );
}

export default function ConversationConsole({
  entries,
  connected,
  sending,
  onSendText,
  defaultOpen,
  showIgnored,
  textInputEnabled,
}: ConversationConsoleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visible = entries.filter((e) => e.role !== "user" || !e.ignored || showIgnored);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries, open]);

  function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void onSendText(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section className={`cc ${open ? "cc-open" : "cc-collapsed"}`} aria-label="Consola de conversación">
      <button
        className="cc-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="cc-body"
      >
        <span className="cc-toggle-label">Conversación</span>
        <span className={`cc-chevron ${open ? "cc-chevron-up" : ""}`} aria-hidden>
          ⌃
        </span>
      </button>

      {open && (
        <div className="cc-body" id="cc-body">
          <div className="cc-scroll" ref={scrollRef} role="log" aria-live="polite">
            {visible.length === 0 ? (
              <p className="cc-empty">Aún no hay conversación. Di «Helion» o escribe abajo.</p>
            ) : (
              visible.map((entry) => <Row key={entry.id} entry={entry} showIgnored={showIgnored} />)
            )}
          </div>

          {textInputEnabled && (
            <div className="cc-input">
              <textarea
                className="cc-textarea"
                placeholder="Escribe a Helion…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                aria-label="Escribe a Helion"
              />
              <button
                className="cc-send"
                onClick={submit}
                disabled={!draft.trim() || sending}
                aria-label="Enviar"
              >
                <SendIcon size={18} />
              </button>
            </div>
          )}
          {!connected && textInputEnabled && (
            <p className="cc-hint">El micrófono no es necesario: escribe y Helion responde igual.</p>
          )}
        </div>
      )}
    </section>
  );
}
