#!/usr/bin/env node
/**
 * Suite VIVA de deriva del self-model (bloque 4, §5). Envía las 8 preguntas
 * canónicas al modelo REAL con las instrucciones de Helion y comprueba que la
 * RESPUESTA transmite los conceptos correctos y no revela secretos ni finge
 * capacidades. Forma parte del RELEASE BENCHMARK, NO de la CI (depende del
 * proveedor y del modelo, que varían). Uso:
 *
 *   OPENAI_API_KEY=... APP_ACCESS_PASSWORD=... node scripts/self-model-drift.mjs
 *
 * Requiere red y clave: sin ellas, imprime el motivo y sale con código 2
 * (bloqueo externo), nunca rompe otra cosa.
 */
import { readEnv } from "../lib/server/env.ts";
import { buildAgentInstructions } from "../lib/server/personality.ts";
import { buildSelfKnowledgeBlock } from "../lib/server/memory/selfKnowledge.ts";
import { SELF_MODEL_QUESTIONS } from "../lib/benchmark/selfModelQuestions.ts";

const { env } = readEnv();
if (!env) {
  console.error("BLOQUEO EXTERNO: faltan variables (OPENAI_API_KEY / APP_ACCESS_PASSWORD).");
  process.exit(2);
}

const instructions = buildAgentInstructions("Helion", "openai_realtime", {
  memoryEnabled: true,
  selfKnowledgeBlock: buildSelfKnowledgeBlock(env, false),
});

async function ask(question) {
  const res = await fetch(`${env.openaiBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.textModel,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: question },
      ],
      temperature: 0.3,
      max_tokens: 200,
    }),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

let pass = 0;
let fail = 0;
for (const q of SELF_MODEL_QUESTIONS) {
  let answer;
  try {
    answer = await ask(q.question);
  } catch (e) {
    console.error(`BLOQUEO EXTERNO al consultar el modelo: ${e.message}`);
    process.exit(2);
  }
  const lower = answer.toLowerCase();
  const missingConcepts = q.mustConvey.filter((c) => !lower.includes(c.toLowerCase()));
  const leaked = q.mustNotContain.filter((c) => lower.includes(c.toLowerCase()));
  const ok = missingConcepts.length === 0 && leaked.length === 0;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} [${q.id}] ${q.question}`);
  console.log(`   → ${answer.replace(/\s+/g, " ").slice(0, 160)}`);
  if (missingConcepts.length) console.log(`   falta transmitir: ${missingConcepts.join(", ")}`);
  if (leaked.length) console.log(`   ⚠ contiene prohibido: ${leaked.join(", ")}`);
}
console.log(`\nSelf-model drift (vivo): ${pass} ok, ${fail} fallos.`);
process.exit(fail > 0 ? 1 : 0);
