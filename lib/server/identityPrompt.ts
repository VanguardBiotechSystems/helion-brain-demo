import type { AccessProfile, IdentityStatus } from "./profiles";

/**
 * Construcción del BLOQUE DE INTERLOCUTOR del prompt (bloque 4: extraído del
 * route para que el presupuesto de prompt se mida contra el código real, no
 * contra una cadena fabricada). Tres estados (§7 del bloque 2): DESCONOCIDO,
 * SUGERIDO (cookie sin confirmar), CONFIRMADO. Redacción compacta para caber
 * en el presupuesto estático de 3.500 caracteres en el PEOR caso.
 */
export function ownerPinNote(requireOwnerPin: boolean, ownerPin: string): string {
  return requireOwnerPin && !ownerPin ? " (owner sin PIN configurado: modo demo)" : "";
}

export function buildIdentityBlock(
  status: IdentityStatus,
  profile: Pick<AccessProfile, "displayName" | "role">,
  pinNote: string,
): string {
  if (status === "unknown") {
    return `

# Interlocutor: DESCONOCIDO
Pregunta con quién hablas ("¿con quién hablo?"). Al identificarse, identity_set (si pide PIN, pídelo con naturalidad); si no quiere, identity_set "visitante". Hasta entonces: solo público, nada privado.${pinNote}`;
  }
  const suggested = status === "claimed" || status === "guest";
  if (suggested) {
    const ownerPin = profile.role === "owner" ? " (owner: pídele el PIN)" : "";
    return `

# Interlocutor: PROBABLE ${profile.displayName} (sin confirmar)
Quizá es ${profile.displayName}; no lo des por seguro: pregúntalo ("¿Sigues siendo tú, ${profile.displayName}?") y confírmalo con identity_set${ownerPin}. Hasta confirmar: solo público, nada privado.${pinNote}`;
  }
  return `

# Interlocutor
Hablas con ${profile.displayName} (${profile.role}); no lo anuncies salvo que pregunten. Cambio → identity_set; "olvida quién soy" → identity_reset. Los recuerdos privados de otros no existen aquí.`;
}
