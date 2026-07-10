import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsSecret } from "@/lib/server/memory/redaction";
import { buildMemoryContext, keywordOverlap, rankMemories, recencyFactor } from "@/lib/server/memory/scoring";
import { validateCuratorOutput } from "@/lib/server/memory/curator";
import { LocalMemoryStore } from "@/lib/server/memory/localStore";
import { createMemory } from "@/lib/server/memory/service";
import type { MemoryItem, NewMemoryItem } from "@/lib/server/memory/types";

function makeItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  const now = new Date().toISOString();
  return {
    id: `mem_${Math.random().toString(36).slice(2)}`,
    profileId: "default",
    type: "semantic",
    title: "Título",
    content: "Contenido",
    canonicalContent: "Contenido",
    summary: "",
    embedding: null,
    importance: 0.6,
    confidence: 0.8,
    source: "system",
    sensitivity: "normal",
    status: "active",
    tags: [],
    relatedEntities: [],
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: null,
    accessCount: 0,
    expiresAt: null,
    provenance: {},
    version: 1,
    ...overrides,
  };
}

function newStore(): LocalMemoryStore {
  const dir = mkdtempSync(join(tmpdir(), "helion-mem-"));
  return new LocalMemoryStore(join(dir, "memory.json"));
}

describe("redaction — nunca guardar secretos", () => {
  it("bloquea claves de API y tokens", () => {
    expect(containsSecret("mi clave es sk-abc123456789def")).toBe(true);
    expect(containsSecret("token efímero ek_9f8e7d6c5b4a")).toBe(true);
    expect(containsSecret("password: hunter2secreto")).toBe(true);
    expect(containsSecret("el passcode es demo-2026")).toBe(true);
    expect(containsSecret("la contraseña es mariposa88")).toBe(true);
    expect(containsSecret("clave de api = abcdef123456")).toBe(true);
    expect(containsSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
  });

  it("no bloquea español normal con la palabra 'clave'", () => {
    expect(containsSecret("la clave del éxito es la constancia")).toBe(false);
    expect(containsSecret("Juanma prefiere una voz juvenil española")).toBe(false);
    expect(containsSecret("mañana hay demo con el creador del robot")).toBe(false);
  });

  it("no bloquea URLs largas legítimas", () => {
    expect(
      containsSecret(
        "la documentación está en https://developers.openai.com/api/docs/guides/realtime/conversaciones/avanzado",
      ),
    ).toBe(false);
  });
});

describe("scoring y ranking", () => {
  it("keywordOverlap puntúa la coincidencia de palabras", () => {
    const item = makeItem({ title: "Voz preferida", canonicalContent: "Prefiere la voz de OpenAI" });
    expect(keywordOverlap("qué voz prefiere", item)).toBeGreaterThan(0);
    expect(keywordOverlap("recetas de cocina italiana", item)).toBe(0);
  });

  it("la recencia decae con el tiempo", () => {
    const fresh = makeItem();
    const old = makeItem({ updatedAt: new Date(Date.now() - 90 * 86_400_000).toISOString() });
    expect(recencyFactor(fresh)).toBeGreaterThan(recencyFactor(old));
  });

  it("rankMemories ordena por relevancia y respeta topK", () => {
    const items = [
      makeItem({ canonicalContent: "El robot usa OpenAI Realtime como voz", importance: 0.9 }),
      makeItem({ canonicalContent: "Al usuario le gusta el café", importance: 0.3 }),
      makeItem({ canonicalContent: "La voz de OpenAI gusta más que ElevenLabs", importance: 0.8 }),
    ];
    const ranked = rankMemories(items, { queryText: "motor de voz OpenAI" }, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].item.canonicalContent).toContain("voz");
  });

  it("los recuerdos archivados no entran en el ranking", () => {
    const items = [makeItem({ status: "archived" }), makeItem()];
    const ranked = rankMemories(items, { queryText: "contenido" }, 5);
    expect(ranked).toHaveLength(1);
  });
});

describe("buildMemoryContext", () => {
  it("respeta el presupuesto de caracteres", () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ canonicalContent: `Recuerdo número ${i} con bastante texto adicional de relleno.` }),
    );
    const block = buildMemoryContext(items, 500);
    expect(block.length).toBeLessThanOrEqual(620); // margen por la última línea
    expect(block.split("\n").length).toBeLessThan(15);
  });

  it("las memorias de seguridad van siempre primero y nunca se expulsan", () => {
    const items = [
      ...Array.from({ length: 30 }, (_, i) => makeItem({ canonicalContent: `Relleno largo ${i} ${"x".repeat(80)}` })),
      makeItem({ type: "safety", canonicalContent: "REGLA: no controlar hardware sin capa segura" }),
    ];
    const block = buildMemoryContext(items, 300);
    expect(block).toContain("REGLA: no controlar hardware");
    expect(block.startsWith("- (safety)")).toBe(true);
  });
});

describe("validateCuratorOutput", () => {
  const validMemory = {
    shouldRemember: true,
    memoryType: "preference",
    title: "Voz preferida",
    canonicalContent: "El usuario prefiere la voz de OpenAI frente a ElevenLabs.",
    importance: 0.8,
    confidence: 0.9,
    sensitivity: "normal",
    tags: ["voz"],
    relatedEntities: ["OpenAI"],
    updateCandidates: [],
    contradictionCandidates: [],
    requiresUserConfirmation: false,
    reason: "preferencia explícita",
  };

  it("acepta salidas válidas", () => {
    const result = validateCuratorOutput({ memories: [validMemory] });
    expect(result).toHaveLength(1);
    expect(result[0].memoryType).toBe("preference");
  });

  it("descarta JSON malformado sin lanzar", () => {
    expect(validateCuratorOutput(null)).toEqual([]);
    expect(validateCuratorOutput({ memories: "no-es-array" })).toEqual([]);
    expect(validateCuratorOutput({ memories: [{ foo: 1 }] })).toEqual([]);
  });

  it("descarta shouldRemember=false y sensibilidad secret", () => {
    expect(validateCuratorOutput({ memories: [{ ...validMemory, shouldRemember: false }] })).toEqual([]);
    expect(validateCuratorOutput({ memories: [{ ...validMemory, sensitivity: "secret" }] })).toEqual([]);
  });

  it("descarta memorias con secretos y ajusta números fuera de rango", () => {
    expect(
      validateCuratorOutput({
        memories: [{ ...validMemory, canonicalContent: "la api key es sk-abc12345678" }],
      }),
    ).toEqual([]);
    const clamped = validateCuratorOutput({ memories: [{ ...validMemory, importance: 7 }] });
    expect(clamped[0].importance).toBe(1);
  });
});

describe("LocalMemoryStore + createMemory (servicio)", () => {
  const input: NewMemoryItem = {
    type: "preference",
    title: "Voz preferida",
    content: "El usuario prefiere la voz de OpenAI.",
    importance: 0.8,
    source: "explicit_user_request",
  };

  it("crea, lista, archiva y borra recuerdos", async () => {
    const store = newStore();
    await store.init();
    const created = await createMemory(store, input, {});
    expect(created.ok).toBe(true);
    const id = created.item!.id;

    expect(await store.list()).toHaveLength(1);

    await store.update(id, { status: "archived" });
    expect(await store.list({ status: "active" })).toHaveLength(0);
    expect(await store.list({ status: "archived" })).toHaveLength(1);

    await store.update(id, { status: "deleted" });
    expect(await store.list({ status: "deleted" })).toHaveLength(1);
    expect(await store.list({ status: "active" })).toHaveLength(0);
  });

  it("rechaza recuerdos con secretos", async () => {
    const store = newStore();
    await store.init();
    const result = await createMemory(store, { ...input, content: "el passcode es demo-2026" }, {});
    expect(result.ok).toBe(false);
    expect(await store.list()).toHaveLength(0);
  });

  it("deduplica por embedding: la preferencia nueva actualiza la antigua", async () => {
    const store = newStore();
    await store.init();
    const embedA = async () => [1, 0, 0];
    const first = await createMemory(store, { ...input, content: "Prefiere la voz cedar." }, { embed: embedA });
    expect(first.deduplicatedInto).toBeUndefined();

    const second = await createMemory(
      store,
      { ...input, content: "Prefiere la voz cedar de OpenAI.", importance: 0.9 },
      { embed: embedA },
    );
    expect(second.deduplicatedInto).toBe(first.item!.id);

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].content).toContain("cedar de OpenAI");
    expect(all[0].importance).toBe(0.9);
    expect(all[0].version).toBeGreaterThan(1);
  });

  it("sin embeddings, deduplica por contenido idéntico", async () => {
    const store = newStore();
    await store.init();
    await createMemory(store, input, {});
    const second = await createMemory(store, input, {});
    expect(second.deduplicatedInto).toBeDefined();
    expect(await store.list()).toHaveLength(1);
  });

  it("registra eventos de auditoría (trazabilidad)", async () => {
    const store = newStore();
    await store.init();
    const created = await createMemory(store, input, { reason: "test" });
    const events = await store.listEvents(created.item!.id);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].action).toBe("created");
  });
});
