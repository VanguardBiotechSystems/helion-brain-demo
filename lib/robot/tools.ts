/**
 * Definición de herramientas (tool calling) para la sesión Realtime.
 * El servidor las declara en la configuración de sesión; el cliente las
 * ejecuta contra el MockRobotAdapter cuando el modelo las invoca.
 * Ninguna herramienta toca hardware real.
 */

export const ROBOT_GESTURE_TOOL_NAME = "robot_gesture";

export const SIMULATED_GESTURES = [
  "WAVE_HAND",
  "MOVE_HEAD",
  "SET_FACE_EXPRESSION",
  "STOP_ALL",
] as const;

export type SimulatedGesture = (typeof SIMULATED_GESTURES)[number];

export const REALTIME_ROBOT_TOOLS = [
  {
    type: "function" as const,
    name: ROBOT_GESTURE_TOOL_NAME,
    description:
      "Registra la INTENCIÓN de un gesto físico sencillo del robot humanoide. No hay hardware conectado: " +
      "el gesto solo se simula y se muestra en pantalla. Úsala cuando el usuario pida un gesto simple " +
      "(saludar, mover la cabeza, cambiar expresión, parar). Nunca la uses para acciones peligrosas.",
    parameters: {
      type: "object",
      properties: {
        gesture: {
          type: "string",
          enum: [...SIMULATED_GESTURES],
          description: "Tipo de gesto solicitado.",
        },
        detail: {
          type: "string",
          description: "Descripción breve del gesto en español, p. ej. 'saludo con la mano derecha'.",
        },
      },
      required: ["gesture"],
      additionalProperties: false,
    },
  },
];
