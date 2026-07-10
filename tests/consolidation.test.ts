import { describe, expect, it } from "vitest";
import { LocalMemoryStore } from "@/lib/server/memory/localStore";
import { createMemory } from "@/lib/server/memory/service";
import {
  runConsolidation,
  decayedConfidence,
  DECAY_MIN_AGE_DAYS,
} from "@/lib/server/memory/consolidation";
import { classifyRelation, decayedConfidenceOnSupersede } from "@/lib/server/memory/relations";
import type { MemoryItem } from "@/lib/server/memory/types";

const NOPERSIST = "/dev/null/no-persist.json";

function item(overrides: Partial<MemoryItem> = {}): MemoryItem {
  const now = new Date().toISOString();
  return {
    id: `m_${Math.random().toString(36).slice(2)}`, profileId: "default", scope: "private", visibility: "private",
    ownerProfileId: "juanma", createdByProfileId: "juanma", allowedProfileIds: [], type: "semantic",
    assertionType: "fact", title: "t", content: "c", canonicalContent: "c", summary: "", embedding: null,
    importance: 0.5, confidence: 0.8, source: "conversation", sensitivity: "normal", status: "active",
    tags: [], relatedEntities: [], createdAt: now, updatedAt: now, lastAccessedAt: null, accessCount: 0,
    expiresAt: null, provenance: {}, version: 1, ...overrides,
  };
}

const DAY = 86_400_000;

describe("fórmula de decaimiento (sección 5)", () => {
  it("no decae dentro de la ventana de gracia", () => {
    const fresh = item({ updatedAt: new Date().toISOString(), confidence: 0.8 });
    expect(decayedConfidence(fresh)).toBe(0.8);
  });

  it("decae con la edad, pero un instruction se protege más que una opinion", () => {
    const now = Date.now();
    const old = new Date(now - 200 * DAY).toISOString();
    const opinion = item({ assertionType: "opinion", updatedAt: old, confidence: 0.8, importance: 0.3 });
    const instruction = item({ assertionType: "instruction", updatedAt: old, confidence: 0.8, importance: 0.3 });
    const dOpinion = decayedConfidence(opinion, now);
    const dInstruction = decayedConfidence(instruction, now);
    expect(dOpinion).toBeLessThan(0.8);
    expect(dInstruction).toBeLessThan(0.8);
    expect(dInstruction).toBeGreaterThan(dOpinion); // instruction decae menos
  });

  it("lo importante y lo muy recuperado apenas decae; nunca bajo el suelo", () => {
    const now = Date.now();
    const old = new Date(now - 400 * DAY).toISOString();
    const important = item({ updatedAt: old, confidence: 0.9, importance: 0.95 });
    expect(decayedConfidence(important, now)).toBeGreaterThan(0.85);
    const lowImportanceOld = item({ updatedAt: old, confidence: 0.2, importance: 0 });
    expect(decayedConfidence(lowImportanceOld, now)).toBeGreaterThanOrEqual(0.1);
  });

  it("la reducción por sustitución tiene suelo", () => {
    expect(decayedConfidenceOnSupersede(0.9)).toBe(0.45);
    expect(decayedConfidenceOnSupersede(0.1)).toBe(0.1);
  });
});

describe("consolidación programada — idempotente, dry-run, protegida", () => {
  it("dry-run cuenta pero no escribe", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    const expired = item({ expiresAt: new Date(Date.now() - 1000).toISOString(), type: "episodic" });
    await store.create(expired);
    const report = await runConsolidation(store, { dryRun: true });
    expect(report.expired).toBe(1);
    const stillActive = await store.list({ status: "active" });
    expect(stillActive.find((m) => m.id === expired.id)).toBeDefined(); // no se tocó
  });

  it("expira efímeros y archiva; reejecutar no vuelve a contarlos (idempotente)", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    await store.create(item({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    const first = await runConsolidation(store, {});
    expect(first.expired).toBe(1);
    const second = await runConsolidation(store, {});
    expect(second.expired).toBe(0); // ya archivado: no reprocesa
  });

  it("respeta la ventana de idempotencia (minIntervalMs)", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    await store.create(item());
    const now = Date.now();
    await runConsolidation(store, { now, minIntervalMs: 3_600_000 });
    const again = await runConsolidation(store, { now: now + 1000, minIntervalMs: 3_600_000 });
    expect(again.skippedRecentRun).toBe(true);
    expect(again.ran).toBe(false);
  });

  it("nunca decae ni archiva memorias de seguridad", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    const safety = item({ type: "safety", scope: "safety", confidence: 0.9, updatedAt: new Date(Date.now() - 400 * DAY).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() });
    await store.create(safety);
    await runConsolidation(store, {});
    const after = await store.get(safety.id);
    expect(after?.status).toBe("active");
    expect(after?.confidence).toBe(0.9);
  });
});

describe("clasificación de relaciones (sección 4)", () => {
  const prev = item({ assertionType: "fact", type: "episodic", canonicalContent: "La demo será el jueves", confidence: 0.9 });

  it("temas distintos: sin relación", () => {
    const v = classifyRelation(prev, { embedding: null, text: "A Juanma le gusta el café" });
    expect(v.relation).toBeNull();
  });

  it("cambio de un plan con lenguaje de cambio: updates + supersede", () => {
    const v = classifyRelation(prev, { embedding: null, text: "La demo se ha movido al viernes", assertionType: "fact" });
    expect(v.relation).toBe("updates");
    expect(v.supersedesPrevious).toBe(true);
  });

  it("preferencia matizada: soporte, no contradicción", () => {
    const opinionPrev = item({ assertionType: "opinion", type: "preference", canonicalContent: "Juanma prefiere respuestas breves" });
    const v = classifyRelation(opinionPrev, { embedding: null, text: "Para temas técnicos Juanma prefiere explicaciones extensas", assertionType: "opinion" });
    expect(v.relation).toBe("supports");
    expect(v.supersedesPrevious).toBe(false);
  });
});

describe("integración: una actualización baja la confianza del recuerdo previo", () => {
  it("guardar 'se ha movido al viernes' relaciona y reduce la confianza del previo", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    const first = await createMemory(store, {
      type: "episodic", assertionType: "fact", title: "Demo",
      content: "La demo del proyecto será el jueves", source: "conversation", confidence: 0.9,
      scope: "project", ownerProfileId: null,
    });
    expect(first.ok).toBe(true);
    await createMemory(store, {
      type: "episodic", assertionType: "fact", title: "Demo",
      content: "La demo del proyecto se ha movido al viernes", source: "conversation", confidence: 0.9,
      scope: "project", ownerProfileId: null,
    });
    const prevAfter = await store.get(first.item!.id);
    expect(prevAfter!.confidence).toBeLessThan(0.9); // fue superado
  });
});
