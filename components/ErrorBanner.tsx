"use client";

import type { AppError } from "@/lib/shared/errors";
import { AlertIcon, CloseIcon } from "./Icons";

interface ErrorBannerProps {
  error: AppError | null;
  onDismiss: () => void;
  action?: { label: string; onClick: () => void } | null;
}

export default function ErrorBanner({ error, onDismiss, action }: ErrorBannerProps) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <AlertIcon size={18} className="error-banner-icon" />
      <div className="error-banner-body">
        <strong>{error.message}</strong>
        {error.hint && <span className="error-banner-hint"> {error.hint}</span>}
      </div>
      {action && (
        <button className="btn btn-small" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <button className="icon-btn error-banner-close" onClick={onDismiss} aria-label="Cerrar aviso">
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
