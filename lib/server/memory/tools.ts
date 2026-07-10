/**
 * Herramientas de memoria para la sesión Realtime. El modelo las invoca;
 * el cliente las ejecuta contra los endpoints autenticados /api/memory/*.
 */

export const MEMORY_TOOL_NAMES = {
  save: "memory_save",
  recall: "memory_recall",
  forget: "memory_forget",
} as const;

export const REALTIME_MEMORY_TOOLS = [
  {
    type: "function" as const,
    name: MEMORY_TOOL_NAMES.save,
    description:
      "Guarda un recuerdo permanente cuando el usuario lo pide explícitamente ('recuerda que…') o cuando " +
      "algo tiene claro valor futuro (decisión, preferencia, dato de una persona, procedimiento). " +
      "PROHIBIDO usarla con claves, contraseñas o credenciales.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "El recuerdo, en una o dos frases canónicas en tercera persona y en español.",
        },
        type: {
          type: "string",
          enum: ["episodic", "semantic", "preference", "person", "project", "procedural"],
          description: "Tipo de recuerdo.",
        },
        sensitivity: {
          type: "string",
          enum: ["normal", "private", "sensitive"],
          description: "Delicadeza del dato. 'sensitive' requiere confirmación explícita del usuario.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: MEMORY_TOOL_NAMES.recall,
    description:
      "Busca en la memoria a largo plazo. Úsala cuando el usuario pregunte qué recuerdas, o cuando " +
      "necesites datos del pasado sobre personas, preferencias, decisiones o el proyecto.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Qué buscar, en lenguaje natural." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: MEMORY_TOOL_NAMES.forget,
    description:
      "Archiva recuerdos que el usuario pide olvidar ('olvida lo que te dije sobre…'). Antes de usarla, " +
      "confirma con el usuario qué quiere olvidar exactamente.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Tema o contenido a olvidar." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];
