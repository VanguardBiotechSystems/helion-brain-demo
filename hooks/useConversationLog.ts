"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { RobotActionInfo, TranscriptEntry } from "@/lib/shared/types";

/**
 * Registro local de la conversación (solo en memoria del navegador).
 * No se persiste nada: al recargar o borrar, desaparece.
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
  // item_id de OpenAI -> id de entrada local
  const userItemMap = useRef(new Map<string, string>());
  // response_id de OpenAI -> id de entrada local
  const agentResponseMap = useRef(new Map<string, string>());

  const addUser = useCallback((text: string) => {
    setEntries((prev) => [...prev, { id: makeId(), role: "user", text, at: Date.now() }]);
  }, []);

  const appendUserPartial = useCallback((itemId: string, delta: string) => {
    setEntries((prev) => {
      const entryId = userItemMap.current.get(itemId);
      if (!entryId) {
        const id = makeId();
        userItemMap.current.set(itemId, id);
        return [...prev, { id, role: "user" as const, text: delta, at: Date.now(), pending: true }];
      }
      return prev.map((e) => (e.id === entryId ? { ...e, text: e.text + delta } : e));
    });
  }, []);

  const finalizeUser = useCallback((itemId: string, transcript: string) => {
    setEntries((prev) => {
      const entryId = userItemMap.current.get(itemId);
      const finalText = transcript.trim();
      if (!entryId) {
        if (!finalText) return prev;
        const id = makeId();
        userItemMap.current.set(itemId, id);
        return [...prev, { id, role: "user" as const, text: finalText, at: Date.now() }];
      }
      if (!finalText) {
        // Transcripción vacía (silencio/ruido): descarta la burbuja pendiente.
        return prev.filter((e) => e.id !== entryId || e.text.trim().length > 0);
      }
      return prev.map((e) => (e.id === entryId ? { ...e, text: finalText, pending: false } : e));
    });
  }, []);

  const startAgent = useCallback((responseId: string) => {
    setEntries((prev) => {
      if (agentResponseMap.current.has(responseId)) return prev;
      const id = makeId();
      agentResponseMap.current.set(responseId, id);
      return [...prev, { id, role: "agent" as const, text: "", at: Date.now(), pending: true }];
    });
  }, []);

  const appendAgent = useCallback((responseId: string, delta: string) => {
    setEntries((prev) => {
      const entryId = agentResponseMap.current.get(responseId);
      if (!entryId) {
        const id = makeId();
        agentResponseMap.current.set(responseId, id);
        return [...prev, { id, role: "agent" as const, text: delta, at: Date.now(), pending: true }];
      }
      return prev.map((e) => (e.id === entryId ? { ...e, text: e.text + delta } : e));
    });
  }, []);

  const finalizeAgent = useCallback((responseId: string, transcript?: string) => {
    setEntries((prev) => {
      const entryId = agentResponseMap.current.get(responseId);
      if (!entryId) return prev;
      return prev
        .map((e) =>
          e.id === entryId ? { ...e, text: (transcript ?? e.text).trim() || e.text, pending: false } : e,
        )
        .filter((e) => e.id !== entryId || e.text.trim().length > 0);
    });
  }, []);

  const addAction = useCallback((action: RobotActionInfo) => {
    setEntries((prev) => [
      ...prev,
      { id: makeId(), role: "action", text: action.detail ?? action.command, at: Date.now(), action },
    ]);
  }, []);

  const addSystem = useCallback((text: string) => {
    setEntries((prev) => [...prev, { id: makeId(), role: "system", text, at: Date.now() }]);
  }, []);

  const clear = useCallback(() => {
    userItemMap.current.clear();
    agentResponseMap.current.clear();
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
