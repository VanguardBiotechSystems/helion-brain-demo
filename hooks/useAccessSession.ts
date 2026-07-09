"use client";

import { useCallback, useState } from "react";
import { toAppError, type AppError } from "@/lib/shared/errors";

/**
 * Gestión de la sesión de acceso (passcode) desde el cliente.
 * La validación real ocurre siempre en servidor (/api/access).
 */
export function useAccessSession() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const login = useCallback(async (passcode: string): Promise<boolean> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (response.ok) return true;

      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      const code = body?.error?.code;
      if (code === "passcode_incorrect") setError(toAppError("passcode_incorrect"));
      else if (code === "rate_limited") setError(toAppError("rate_limited"));
      else if (code === "config_missing") setError(toAppError("config_missing"));
      else setError(toAppError("unknown", body?.error?.message));
      return false;
    } catch {
      setError(toAppError("network_offline", "No se pudo contactar con el servidor.", "Revisa tu conexión y vuelve a intentarlo."));
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch("/api/access", { method: "DELETE" });
    } finally {
      window.location.reload();
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { submitting, error, login, logout, clearError };
}
