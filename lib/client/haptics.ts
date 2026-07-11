"use client";

/**
 * Haptics ligeros en móvil (bloque 3, §12). Solo cuando el navegador lo
 * permite y el usuario NO ha pedido reducir movimiento/feedback. Nunca
 * produce errores en navegadores sin soporte: es opcional y silencioso.
 */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** ¿Hay soporte de vibración y el usuario no pidió reducir feedback? */
export function hapticsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function" &&
    !prefersReducedMotion()
  );
}

/**
 * Vibración breve. `pattern` en ms (número o secuencia). Se ignora en
 * silencio si no hay soporte o el usuario redujo el feedback.
 */
export function haptic(pattern: number | number[] = 12): void {
  if (!hapticsAvailable()) return;
  try {
    (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate(pattern);
  } catch {
    // Sin haptics: no es un error.
  }
}
