/** Herramientas de identidad conversacional para la sesión Realtime. */
export const IDENTITY_TOOL_NAMES = { set: "identity_set", reset: "identity_reset" } as const;

export const REALTIME_IDENTITY_TOOLS = [
  {
    type: "function" as const,
    name: IDENTITY_TOOL_NAMES.set,
    description:
      "Fija o cambia el interlocutor actual cuando alguien se identifica ('Soy Sergio', 'ahora habla Juanma', " +
      "'soy un inversor'). Si el perfil exige PIN, el resultado lo indicará: pídeselo y vuelve a llamar con pin.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre o descripción con la que se identifica la persona." },
        pin: { type: "string", description: "PIN de confirmación si el perfil lo exige (p. ej. owner)." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: IDENTITY_TOOL_NAMES.reset,
    description: "Olvida la identidad de esta sesión ('olvida quién soy'): vuelve a interlocutor desconocido.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];
