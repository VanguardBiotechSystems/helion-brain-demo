"use client";

import { useState, type FormEvent } from "react";
import { useAccessSession } from "@/hooks/useAccessSession";

/**
 * Pantalla de acceso por passcode. La validación ocurre en servidor y la
 * sesión se materializa como cookie httpOnly firmada: aquí no hay secretos.
 */
export default function AccessGate({ appName }: { appName: string }) {
  const { submitting, error, login, clearError } = useAccessSession();
  const [passcode, setPasscode] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !passcode) return;
    const ok = await login(passcode);
    if (ok) {
      window.location.reload();
    }
  }

  return (
    <div className="gate-screen">
      <div className="gate-card">
        <div className="gate-mark" aria-hidden />
        <h1 className="gate-title">{appName}</h1>
        <p className="gate-text">
          Cerebro conversacional cloud para robot humanoide. Voz en tiempo real.
          <br />
          <span className="gate-text-dim">Sin control físico conectado todavía.</span>
        </p>

        <form className="gate-form" onSubmit={handleSubmit}>
          <label className="gate-label" htmlFor="passcode">
            Código de acceso
          </label>
          <input
            id="passcode"
            className="gate-input"
            type="password"
            autoComplete="current-password"
            autoFocus
            placeholder="••••••••"
            value={passcode}
            onChange={(event) => {
              setPasscode(event.target.value);
              if (error) clearError();
            }}
            disabled={submitting}
          />
          {error && (
            <p className="gate-error" role="alert">
              {error.message} {error.hint && <span className="gate-text-dim">{error.hint}</span>}
            </p>
          )}
          <button className="btn btn-primary gate-submit" type="submit" disabled={submitting || !passcode}>
            {submitting ? "Verificando…" : "Entrar"}
          </button>
        </form>

        <p className="gate-footnote">Demo privada · acceso restringido</p>
      </div>
    </div>
  );
}
