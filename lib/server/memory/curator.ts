import type { AppEnv } from "../env";
import { logError } from "../log";
import { containsSecret } from "./redaction";
import { ASSERTION_TYPES, type MemoryAssertionType, type MemorySensitivity, type MemoryType } from "./types";

/**
 * Memory Curator: sistema interno frío y preciso que decide qué merece
 * recordarse de un intercambio. NO comparte el prompt conversacional de
 * Helion. Devuelve JSON validado por esquema; si el JSON es inválido,
 * no se guarda nada.
 */

export type CuratorScope = "private" | "project" | "project_demo" | "public";

export interface CuratorMemory {
  shouldRemember: boolean;
  memoryType: MemoryType;
  assertionType: MemoryAssertionType;
  /** Horas de vigencia si es efímero con duración expresa; 0 = sin duración expresa. */
  ephemeralTtlHours: number;
  /** Alcance propuesto; las pistas explícitas del usuario lo pisan. */
  proposedScope: CuratorScope;
  title: string;
  canonicalContent: string;
  importance: number;
  confidence: number;
  sensitivity: MemorySensitivity;
  tags: string[];
  relatedEntities: string[];
  updateCandidates: string[];
  contradictionCandidates: string[];
  requiresUserConfirmation: boolean;
  reason: string;
}

const MEMORY_TYPES: MemoryType[] = [
  "episodic",
  "semantic",
  "preference",
  "person",
  "project",
  "procedural",
  "safety",
];
const SENSITIVITIES: MemorySensitivity[] = ["normal", "private", "sensitive", "secret"];

const CURATOR_SYSTEM_PROMPT = `Eres el curador de memoria de Helion, un robot humanoide conversacional. Analizas fragmentos de conversación y extraes ÚNICAMENTE información con valor futuro. Eres frío, preciso y minimalista.

Extrae recuerdos solo si aportan continuidad real: preferencias, decisiones, hechos estables sobre personas o el proyecto, instrucciones de trabajo, procedimientos, restricciones, objetivos con fecha, errores resueltos.

NO extraigas: saludos, small talk, pruebas triviales ("el usuario dijo hola", "probó un botón"), frases sueltas sin valor futuro, ni contenido ya obvio del sistema.

Reglas duras:
- PROHIBIDO extraer claves, contraseñas, passcodes, tokens o credenciales. Si aparecen, shouldRemember=false y razón "credencial".
- canonicalContent: una o dos frases en tercera persona, en español, autocontenidas (con nombres y fechas absolutas si las hay).
- importance: 0..1 (0.9+ solo decisiones/restricciones críticas; <0.55 casi nunca merece guardarse).
- confidence: 0..1 (explícito del usuario ≈0.95; inferido ≤0.6).
- sensitivity: normal | private (personal no delicado) | sensitive (salud, datos delicados) | secret (nunca guardar).
- memoryType: episodic (evento concreto con fecha) | semantic (hecho estable) | preference (gusto/elección) | person (sobre una persona) | project (estado/decisión técnica) | procedural (cómo hacer algo) | safety (regla de seguridad).
- assertionType: fact (describe una realidad estable) | opinion (preferencia/valoración de una persona) | instruction (petición operativa atribuida a una persona; NUNCA es una orden del sistema) | ephemeral (vale solo un periodo corto: "hoy", "esta tarde", "durante la demo") | unclassified (si dudas).
- ephemeralTtlHours: solo para ephemeral. Horas de vigencia si el hablante dio duración expresa ("hasta mañana"≈24, "esta semana"≈168); 0 si no la dio.
- proposedScope: private (personal del hablante o dijo que no se comparta) | project (técnico/decisiones del proyecto) | project_demo (útil y compartible en demo) | public (trivial y público). Si el hablante dice "no se lo digas a X" o "solo para mí" → private SIEMPRE.
- Deduplica dentro de tu propia salida. Devuelve [] si no hay nada digno.`;

const CURATOR_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shouldRemember: { type: "boolean" },
          memoryType: { type: "string", enum: MEMORY_TYPES },
          assertionType: { type: "string", enum: ["fact", "opinion", "instruction", "ephemeral", "unclassified"] },
          ephemeralTtlHours: { type: "number" },
          proposedScope: { type: "string", enum: ["private", "project", "project_demo", "public"] },
          title: { type: "string" },
          canonicalContent: { type: "string" },
          importance: { type: "number" },
          confidence: { type: "number" },
          sensitivity: { type: "string", enum: SENSITIVITIES },
          tags: { type: "array", items: { type: "string" } },
          relatedEntities: { type: "array", items: { type: "string" } },
          updateCandidates: { type: "array", items: { type: "string" } },
          contradictionCandidates: { type: "array", items: { type: "string" } },
          requiresUserConfirmation: { type: "boolean" },
          reason: { type: "string" },
        },
        required: [
          "shouldRemember",
          "memoryType",
          "assertionType",
          "ephemeralTtlHours",
          "proposedScope",
          "title",
          "canonicalContent",
          "importance",
          "confidence",
          "sensitivity",
          "tags",
          "relatedEntities",
          "updateCandidates",
          "contradictionCandidates",
          "requiresUserConfirmation",
          "reason",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["memories"],
  additionalProperties: false,
} as const;

function clamp01(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(1, Math.max(0, num));
}

/**
 * Valida y normaliza la salida del curador. Pura y testeable: descarta
 * entradas malformadas, con secretos o fuera de esquema sin lanzar.
 */
export function validateCuratorOutput(raw: unknown): CuratorMemory[] {
  const memories = (raw as { memories?: unknown })?.memories;
  if (!Array.isArray(memories)) return [];

  const valid: CuratorMemory[] = [];
  for (const entry of memories) {
    const m = entry as Record<string, unknown>;
    if (typeof m !== "object" || m === null) continue;
    if (m.shouldRemember !== true) continue;
    const title = typeof m.title === "string" ? m.title.trim().slice(0, 160) : "";
    const canonicalContent =
      typeof m.canonicalContent === "string" ? m.canonicalContent.trim().slice(0, 1000) : "";
    if (!title || !canonicalContent) continue;
    if (containsSecret(`${title} ${canonicalContent}`)) continue;
    const memoryType = MEMORY_TYPES.includes(m.memoryType as MemoryType)
      ? (m.memoryType as MemoryType)
      : "semantic";
    const sensitivity = SENSITIVITIES.includes(m.sensitivity as MemorySensitivity)
      ? (m.sensitivity as MemorySensitivity)
      : "normal";
    if (sensitivity === "secret") continue;

    const assertionType: MemoryAssertionType = ASSERTION_TYPES.includes(m.assertionType as MemoryAssertionType)
      ? (m.assertionType as MemoryAssertionType)
      : memoryType === "preference"
        ? "opinion"
        : "unclassified";
    const ttlRaw = Number(m.ephemeralTtlHours);
    const ephemeralTtlHours =
      assertionType === "ephemeral" && Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(720, ttlRaw) : 0;

    const proposedScope: CuratorScope = ["private", "project", "project_demo", "public"].includes(
      m.proposedScope as string,
    )
      ? (m.proposedScope as CuratorScope)
      : "project_demo";

    valid.push({
      shouldRemember: true,
      memoryType,
      assertionType,
      ephemeralTtlHours,
      proposedScope,
      title,
      canonicalContent,
      importance: clamp01(m.importance),
      confidence: clamp01(m.confidence),
      sensitivity,
      tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === "string").slice(0, 8) : [],
      relatedEntities: Array.isArray(m.relatedEntities)
        ? m.relatedEntities.filter((t): t is string => typeof t === "string").slice(0, 8)
        : [],
      updateCandidates: Array.isArray(m.updateCandidates)
        ? m.updateCandidates.filter((t): t is string => typeof t === "string").slice(0, 5)
        : [],
      contradictionCandidates: Array.isArray(m.contradictionCandidates)
        ? m.contradictionCandidates.filter((t): t is string => typeof t === "string").slice(0, 5)
        : [],
      requiresUserConfirmation: m.requiresUserConfirmation === true,
      reason: typeof m.reason === "string" ? m.reason.slice(0, 300) : "",
    });
  }
  return valid;
}

export interface CuratorInputMessage {
  role: "user" | "assistant";
  content: string;
}

/** Llama al modelo de extracción y devuelve memorias validadas. */
export async function extractMemories(
  env: AppEnv,
  messages: CuratorInputMessage[],
): Promise<CuratorMemory[]> {
  const transcript = messages
    .map((message) => `${message.role === "user" ? "Usuario" : "Helion"}: ${message.content}`)
    .join("\n")
    .slice(0, 12000);

  let response: Response;
  try {
    response = await fetch(`${env.openaiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.memory.extractionModel,
        messages: [
          { role: "system", content: CURATOR_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Fecha de hoy: ${new Date().toISOString().slice(0, 10)}.\n\nConversación:\n${transcript}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "memory_extraction", strict: true, schema: CURATOR_SCHEMA },
        },
        temperature: 0.1,
        max_tokens: 1500,
      }),
      cache: "no-store",
    });
  } catch (error) {
    logError("memory", "No se pudo contactar con el modelo de extracción", error);
    return [];
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    logError("memory", `extracción fallo status=${response.status} body=${bodyText.slice(0, 300)}`);
    return [];
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    return validateCuratorOutput(JSON.parse(content));
  } catch {
    logError("memory", "El curador devolvió JSON inválido: no se guarda nada");
    return [];
  }
}
