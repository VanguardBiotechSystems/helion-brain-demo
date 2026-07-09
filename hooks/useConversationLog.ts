"use client";

import { useCallback, useMemo, useState } from "react";
import type { RobotActionInfo, TranscriptEntry } from "@/lib/shared/types";

/**
 * Registro local de la conversación (solo en memoria del navegador).
 * No se persiste nada: al recargar o borrar, desaparece.
 *
 * Los ids de las entradas de voz derivan de los ids de OpenAI
 * (item_id / response_id), de modo que los updaters de estado son puros
 * e idempotentes: seguros bajo React StrictMode y replays concurrentes.
 */

export interface ConversationLog {
  entries: TranscriptEntry[];
  count: number;
  addUser(text: string): void;
  appendUserPartial(itemId: string, delta: string): void;
  finalizeUser(itemId: string, transcript: string): void;
  startAgent(responseId: string): void;
  appendAgent(responseId: string, delta: string): void;
  finalizeAgent(responseId: string, transcript?: string): void;
  addAction(action: RobotActionInfo): void;
  addSystem(text: string): void;
  clear(): void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useConversationLog(): ConversationLog {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);

  const addUser = useCallback((text: string) => {
    const entry: TranscriptEntry = { id: makeId(), role: "user", text, at: Date.now() };
    setEntries((prev) => [...prev, entry]);
  }, []);

  const appendUserPartial = useCallback((itemId: string, delta: string) => {
    const id = `user-${itemId}`;
    const at = Date.now();
    setEntries((prev) => {
      if (!prev.some((e) => e.id === id)) {
        return [...prev, { id, role: "user" as const, text: delta, at, pending: true }];
      }
      return prev.map((e) => (e.id === id ? { ...e, text: e.text + delta } : e));
    });
  }, []);

  const finalizeUser = useCallback((itemId: string, transcript: string) => {
    const id = `user-${itemId}`;
    const finalText = transcript.trim();
    const at = Date.now();
    setEntries((prev) => {
      if (!prev.some((e) => e.id === id)) {
        return finalText ? [...prev, { id, role: "user" as const, text: finalText, at }] : prev;
      }
      if (!finalText) {
        // Transcripción vacía (silencio/ruido): descarta la burbuja si no acumuló texto.
        return prev.filter((e) => e.id !== id || e.text.trim().length > 0);
      }
      return prev.map((e) => (e.id === id ? { ...e, text: finalText, pending: false } : e));
    });
  }, []);

  const startAgent = useCallback((responseId: string) => {
    const id = `agent-${responseId}`;
    const at = Date.now();
    setEntries((prev) =>
      prev.some((e) => e.id === id)
        ? prev
        : [...prev, { id, role: "agent" as const, text: "", at, pending: true }],
    );
  }, []);

  const appendAgent = useCallback((responseId: string, delta: string) => {
    const id = `agent-${responseId}`;
    const at = Date.now();
    setEntries((prev) => {
      if (!prev.some((e) => e.id === id)) {
        return [...prev, { id, role: "agent" as const, text: delta, at, pending: true }];
      }
      return prev.map((e) => (e.id === id ? { ...e, text: e.text + delta } : e));
    });
  }, []);

  const finalizeAgent = useCallback((responseId: string, transcript?: string) => {
    const id = `agent-${responseId}`;
    setEntries((prev) =>
      prev
        .map((e) =>
          e.id === id ? { ...e, text: (transcript ?? e.text).trim() || e.text, pending: false } : e,
        )
        .filter((e) => e.id !== id || e.text.trim().length > 0),
    );
  }, []);

  const addAction = useCallback((action: RobotActionInfo) => {
    const entry: TranscriptEntry = {
      id: makeId(),
      role: "action",
      text: action.detail ?? action.command,
      at: Date.now(),
      action,
    };
    setEntries((prev) => [...prev, entry]);
  }, []);

  const addSystem = useCallback((text: string) => {
    const entry: TranscriptEntry = { id: makeId(), role: "system", text, at: Date.now() };
    setEntries((prev) => [...prev, entry]);
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  return useMemo(
    () => ({
      entries,
      count: entries.length,
      addUser,
      appendUserPartial,
      finalizeUser,
      startAgent,
      appendAgent,
      finalizeAgent,
      addAction,
      addSystem,
      clear,
    }),
    [entries, addUser, appendUserPartial, finalizeUser, startAgent, appendAgent, finalizeAgent, addAction, addSystem, clear],
  );
}
