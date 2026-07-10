"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { MemorySummary } from "@/lib/shared/types";
import { CloseIcon, TrashIcon } from "./Icons";

interface MemoryItemView {
  id: string;
  type: string;
  title: string;
  content: string;
  importance: number;
  status: string;
  updatedAt: string;
  source?: string;
  score?: number;
}

interface MemoryPanelProps {
  open: boolean;
  onClose: () => void;
  memoryActive: boolean;
  onToggleActive: (active: boolean) => void;
  lastRecall: MemorySummary[];
  memorySavedCount: number;
  onExtractNow: () => Promise<void>;
}

const TYPE_LABEL: Record<string, string> = {
  episodic: "episódico",
  semantic: "hecho",
  preference: "preferencia",
  person: "persona",
  project: "proyecto",
  procedural: "procedimiento",
  safety: "seguridad",
};

/**
 * Panel de memoria: lista, búsqueda, borrado, archivado y extracción manual.
 * Todo pasa por los endpoints autenticados /api/memory/*.
 */
export default function MemoryPanel({
  open,
  onClose,
  memoryActive,
  onToggleActive,
  lastRecall,
  memorySavedCount,
  onExtractNow,
}: MemoryPanelProps) {
  const [items, setItems] = useState<MemoryItemView[]>([]);
  const [provider, setProvider] = useState<string>("—");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [serverDisabled, setServerDisabled] = useState(false);
  const [health, setHealth] = useState<{ persistent?: boolean; providerEffective?: string; profile?: { displayName?: string } } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/memory");
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessage(body?.error?.message ?? "No se pudo cargar la memoria.");
        setServerDisabled(response.status === 503);
        setItems([]);
        return;
      }
      const data = (await response.json()) as { provider: string; items: MemoryItemView[] };
      setProvider(data.provider);
      setItems(data.items);
      setSearching(false);
      setServerDisabled(false);
    } catch {
      setMessage("No se pudo contactar con el servidor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
      fetch("/api/memory/health")
        .then((r) => (r.ok ? r.json() : null))
        .then(setHealth)
        .catch(() => {});
    }
  }, [open, load]);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) {
      void load();
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, topK: 12 }),
      });
      if (!response.ok) {
        setMessage("La búsqueda falló.");
        return;
      }
      const data = (await response.json()) as { results: MemoryItemView[] };
      setItems(data.results.map((result) => ({ ...result, status: "active" })));
      setSearching(true);
    } catch {
      setMessage("La búsqueda falló.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/memory/${id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }

  async function handleArchive(id: string) {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    }).catch(() => {});
    void load();
  }

  async function handleExtract() {
    setLoading(true);
    setMessage("");
    try {
      await onExtractNow();
      setMessage("Extracción lanzada: el curador guarda solo lo relevante.");
      setTimeout(() => void load(), 1500);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="diag-overlay" onClick={onClose}>
      <section
        className="diag-panel"
        role="dialog"
        aria-label="Panel de memoria"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="diag-head">
          <h2>Memoria</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar memoria">
            <CloseIcon />
          </button>
        </div>

        {serverDisabled ? (
          <p className="diag-note">{message || "La memoria está desactivada en el servidor."}</p>
        ) : (
          <>
            <div className="mem-controls">
              <label className="mem-toggle">
                <input
                  type="checkbox"
                  checked={memoryActive}
                  onChange={(event) => onToggleActive(event.target.checked)}
                />
                Memoria activada en esta sesión
              </label>
              <span className="diag-note">
                proveedor: <code>{provider}</code> · guardados en esta sesión: {memorySavedCount}
                {health && (
                  <>
                    {" "}· perfil: <code>{health.profile?.displayName ?? "—"}</code> ·{" "}
                    {health.persistent ? "PERSISTENTE ✓" : "⚠ NO persistente (efímera en este despliegue)"}
                  </>
                )}
              </span>
            </div>

            <form className="mem-search" onSubmit={handleSearch}>
              <input
                className="composer-input"
                type="text"
                placeholder="Buscar recuerdos…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button className="btn btn-small" type="submit" disabled={loading}>
                {searching ? "Buscar de nuevo" : "Buscar"}
              </button>
            </form>

            <div className="mem-actions">
              <button className="btn btn-small" onClick={() => void handleExtract()} disabled={loading}>
                Extraer memoria de esta conversación
              </button>
              {searching && (
                <button className="btn btn-small" onClick={() => void load()} disabled={loading}>
                  Ver todos
                </button>
              )}
            </div>

            {message && <p className="diag-note">{message}</p>}

            {lastRecall.length > 0 && (
              <>
                <h3 className="diag-subtitle">Usados en la última respuesta</h3>
                <ul className="mem-recall">
                  {lastRecall.map((memory) => (
                    <li key={memory.id}>
                      <span className="mem-type">{TYPE_LABEL[memory.type] ?? memory.type}</span>{" "}
                      {memory.content}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3 className="diag-subtitle">
              {searching ? "Resultados" : "Recuerdos activos"} ({items.length})
            </h3>
            {loading && <p className="diag-note">Cargando…</p>}
            <ul className="mem-list">
              {items.map((item) => (
                <li key={item.id} className="mem-item">
                  <div className="mem-item-head">
                    <span className="mem-type">{TYPE_LABEL[item.type] ?? item.type}</span>
                    <span className="mem-meta">
                      {"scope" in item && (item as { scope?: string }).scope ? `${(item as { scope?: string }).scope} · ` : ""}
                      imp. {Math.round(item.importance * 100) / 100}
                      {typeof item.score === "number" ? ` · score ${item.score}` : ""} ·{" "}
                      {new Date(item.updatedAt).toLocaleDateString("es-ES")}
                    </span>
                    <span className="mem-item-buttons">
                      <button
                        className="icon-btn mem-btn"
                        onClick={() => void handleArchive(item.id)}
                        title="Archivar recuerdo"
                        aria-label="Archivar recuerdo"
                      >
                        ⤓
                      </button>
                      <button
                        className="icon-btn mem-btn"
                        onClick={() => void handleDelete(item.id)}
                        title="Borrar recuerdo"
                        aria-label="Borrar recuerdo"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </span>
                  </div>
                  <div className="mem-item-title">{item.title}</div>
                  <div className="mem-item-content">{item.content}</div>
                </li>
              ))}
              {!loading && items.length === 0 && (
                <li className="diag-note">Sin recuerdos {searching ? "que casen con la búsqueda" : "activos"}.</li>
              )}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
