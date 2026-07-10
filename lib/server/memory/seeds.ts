import type { NewMemoryItem } from "./types";

/**
 * Memoria inicial del proyecto Helion (sin secretos). Se inserta una sola
 * vez cuando el almacén está vacío, con fuente "system".
 */
export const SEED_MEMORIES: NewMemoryItem[] = [
  {
    type: "project",
    title: "Qué es Helion",
    content: "Helion es un cerebro conversacional cloud para un robot humanoide en desarrollo.",
    importance: 0.9,
    confidence: 1,
    source: "system",
    tags: ["helion", "proyecto"],
  },
  {
    type: "safety",
    title: "Sin conexión física segura",
    content:
      "El robot todavía no tiene conexión física segura: Helion no controla hardware real y no debe fingir capacidades físicas.",
    importance: 1,
    confidence: 1,
    source: "system",
    tags: ["seguridad", "hardware"],
  },
  {
    type: "safety",
    title: "Camino obligatorio hacia el hardware",
    content:
      "Cualquier control físico futuro debe pasar por un RobotAdapter seguro, simulador, confirmaciones humanas y parada de emergencia.",
    importance: 1,
    confidence: 1,
    source: "system",
    tags: ["seguridad", "robotadapter", "e-stop"],
  },
  {
    type: "safety",
    title: "Sin secretos en memoria",
    content:
      "Helion nunca guarda claves, contraseñas, passcodes ni credenciales en su memoria, aunque el usuario se las dicte.",
    importance: 1,
    confidence: 1,
    source: "system",
    tags: ["seguridad", "privacidad"],
  },
  {
    type: "preference",
    title: "Motor de voz elegido",
    content:
      "De momento se descarta ElevenLabs: al usuario le gusta más la voz de OpenAI, y OpenAI Realtime es el motor de voz principal.",
    importance: 0.85,
    confidence: 0.95,
    source: "system",
    tags: ["voz", "openai", "elevenlabs"],
  },
  {
    type: "project",
    title: "Forma de la demo",
    content:
      "La demo de Helion debe ser usable desde una URL pública protegida por passcode, sin instalar nada.",
    importance: 0.8,
    confidence: 1,
    source: "system",
    tags: ["demo", "despliegue"],
  },
  {
    type: "project",
    title: "Prioridad actual",
    content:
      "La prioridad actual del proyecto es que Helion no reaccione al ruido (tecleo, golpes) y que tenga memoria compleja persistente.",
    importance: 0.85,
    confidence: 1,
    source: "system",
    tags: ["audio", "memoria", "roadmap"],
  },
];
