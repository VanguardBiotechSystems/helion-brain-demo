import { buildAgentInstructions } from "@/lib/server/personality";

/**
 * Extrae las respuestas POSITIVAS (ejemplos buenos) de la sección de
 * contraste de la constitución de voz. Para cada línea `estímulo → respuesta
 * (nunca: …)`, devuelve solo la parte de la respuesta buena (antes de
 * "(nunca:"). Se usa como regresión: los ejemplos buenos deben estar limpios
 * de clichés/arranques/seguimientos prohibidos.
 */
export function constitutionExamples(): string[] {
  const prompt = buildAgentInstructions("Helion", "openai_realtime");
  const start = prompt.indexOf("# Contraste");
  if (start < 0) return [];
  const section = prompt.slice(start);
  const lines = section.split("\n").slice(1); // salta el encabezado
  const examples: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.includes("→")) continue;
    let answer = line.slice(line.indexOf("→") + 1).trim();
    const nunca = answer.toLowerCase().indexOf("(nunca:");
    if (nunca >= 0) answer = answer.slice(0, nunca).trim();
    // Quita comillas envolventes si las hay.
    answer = answer.replace(/^"(.*)"$/, "$1").trim();
    if (answer) examples.push(answer);
  }
  return examples;
}
