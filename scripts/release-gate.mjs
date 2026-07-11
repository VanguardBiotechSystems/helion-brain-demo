#!/usr/bin/env node
/**
 * Release gate AUTOMÁTICO de Helion (bloque 4, §12). Ejecuta las puertas
 * deterministas y falla con código != 0 si alguna no pasa. NO ejecuta el
 * benchmark vivo ni las pruebas de navegador reales (van en el gate manual,
 * docs/RELEASE_CHECKLIST.md). Uso: `node scripts/release-gate.mjs`.
 *
 * Comprueba: árbol git limpio, lint, typecheck, tests, build, escaneo de
 * secretos en archivos versionados, presupuesto de prompt (≤3500) y que el
 * .env real no esté versionado.
 */
import { execSync } from "node:child_process";

const steps = [];
function run(name, cmd, opts = {}) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    const out = execSync(cmd, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8" });
    steps.push({ name, ok: true });
    return out ?? "";
  } catch (error) {
    steps.push({ name, ok: false, detail: error.stdout?.toString?.().slice(-400) ?? String(error).slice(-400) });
    if (opts.soft) return "";
    return null;
  }
}

// 1) Árbol git limpio (no bloqueante si se ejecuta con cambios locales
//    deliberados, pero se avisa).
const dirty = run("Árbol git limpio", "git status --porcelain", { capture: true, soft: true });
if (dirty && dirty.trim().length > 0) {
  console.warn("⚠ Hay cambios sin commitear:\n" + dirty);
  steps[steps.length - 1].ok = false;
}

// 2) El .env real nunca versionado.
const trackedEnv = run("Sin .env real versionado", "git ls-files | grep -E '^\\.env' | grep -v '.env.example' || true", { capture: true });
if (trackedEnv && trackedEnv.trim().length > 0) {
  console.error("✖ Hay archivos .env versionados: " + trackedEnv);
  steps[steps.length - 1].ok = false;
}

// 3) Escaneo de secretos en archivos versionados (excluye ejemplos/docs/lock).
const secretScan = run(
  "Escaneo de secretos",
  "git ls-files | grep -vE '\\.env\\.example|package-lock|docs/' | " +
    "xargs grep -nE 'sk-[A-Za-z0-9]{20,}|ELEVENLABS_API_KEY=[A-Za-z0-9]|OWNER_IDENTITY_PIN=[0-9]{2,}|postgres://[^ ]+:[^ ]+@' 2>/dev/null || true",
  { capture: true },
);
if (secretScan && secretScan.trim().length > 0) {
  console.error("✖ Posibles secretos versionados:\n" + secretScan);
  steps[steps.length - 1].ok = false;
}

// 4) Gates de calidad deterministas.
run("Lint", "npm run lint");
run("Typecheck", "npm run typecheck");
run("Tests (unit + integración)", "npm run test");
run("Build", "npm run build");

// 5) Presupuesto de prompt (≤3500) — vía el test dedicado, ya cubierto arriba,
//    pero se reafirma de forma explícita.
run("Presupuesto de prompt (≤3500)", "npx vitest run tests/personality.test.ts", { });

// 6) Contratos de privacidad / inyección / roles / telemetría.
run("Privacidad, inyección, roles y telemetría",
  "npx vitest run tests/injection.test.ts tests/scrub.test.ts tests/authz.test.ts tests/telemetry.test.ts tests/pending.test.ts");

const failed = steps.filter((s) => !s.ok);
console.log("\n──────────── RELEASE GATE ────────────");
for (const s of steps) console.log(`${s.ok ? "✅" : "❌"} ${s.name}`);
if (failed.length > 0) {
  console.log(`\nRESULTADO: ❌ FAIL (${failed.length} puertas). El gate manual (E2E navegador, benchmark vivo) es aparte.`);
  process.exit(1);
}
console.log("\nRESULTADO: ✅ Gate automático PASADO. Falta el gate MANUAL (docs/RELEASE_CHECKLIST.md): E2E real, Safari/Chrome, micrófono, barge-in, benchmark vivo, PIN/kill switches configurados.");
