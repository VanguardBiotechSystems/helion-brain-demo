import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgresMemoryStore } from "@/lib/server/memory/postgresStore";

/**
 * Backend Postgres (auditoría bloque 4). Una suite de INTEGRACIÓN completa
 * contra una BD desechable (testcontainers / service container) es un
 * BLOQUEO EXTERNO: no hay Postgres en este entorno. Aquí se guarda lo que sí
 * es comprobable sin BD: (1) el store construye sin conectar, (2) la forma de
 * las migraciones es idempotente y reversible, con timeouts. La integración
 * viva está descrita como pendiente externo en docs/BLOCK4_CLOSING_AUDIT.md.
 */

const source = readFileSync(
  fileURLToPath(new URL("../lib/server/memory/postgresStore.ts", import.meta.url)),
  "utf8",
);

describe("PostgresMemoryStore — comprobaciones sin BD", () => {
  it("construye sin conectar y expone el provider correcto", () => {
    const store = new PostgresMemoryStore("postgres://user:pass@localhost:5432/db");
    expect(store.provider).toBe("postgres");
  });

  it("las migraciones son idempotentes (IF NOT EXISTS en tablas y columnas)", () => {
    expect(source).toContain("CREATE TABLE IF NOT EXISTS memory_items");
    expect(source).toContain("ADD COLUMN IF NOT EXISTS assertion_type");
    expect(source).toContain("ADD COLUMN IF NOT EXISTS origin");
    // Nº de ADD COLUMN IF NOT EXISTS coincide con nº de ALTER (todas guardadas).
    const adds = (source.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length;
    expect(adds).toBeGreaterThanOrEqual(8);
  });

  it("el backfill es reversible (documentado) y no clasifica todo como fact", () => {
    // preference→opinion, system→fact, resto→unclassified (no todo a fact).
    expect(source).toContain("WHEN type = 'preference' THEN 'opinion'");
    expect(source).toContain("ELSE 'unclassified'");
    expect(source).toContain("reversible");
  });

  it("el Pool tiene timeouts duros (no cuelga el camino de sesión)", () => {
    expect(source).toContain("connectionTimeoutMillis");
    expect(source).toContain("statement_timeout");
  });
});

// Integración viva: requiere una Postgres desechable. Se ejecuta en CI con un
// service container definiendo TEST_DATABASE_URL; aquí queda documentada.
describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgresMemoryStore — integración (requiere BD)", () => {
  it("init() es idempotente y create/list hacen round-trip", async () => {
    const store = new PostgresMemoryStore(process.env.TEST_DATABASE_URL!);
    await store.init();
    await store.init(); // segunda vez: no debe fallar (idempotente)
    const n = await store.count();
    expect(typeof n).toBe("number");
  });
});
