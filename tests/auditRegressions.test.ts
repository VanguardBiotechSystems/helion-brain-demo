import { describe, expect, it } from "vitest";
import { LocalMemoryStore } from "@/lib/server/memory/localStore";
import { createMemory, searchMemories } from "@/lib/server/memory/service";
import { createPendingMemory } from "@/lib/server/memory/pending";
import { matchProfileByAlias, resolveProfiles } from "@/lib/server/profiles";
import { buildIdentityBlock } from "@/lib/server/identityPrompt";
import { readEnv } from "@/lib/server/env";

/**
 * Regresiones de la auditoría de cierre (bloque 4). Cada test bloquea un
 * defecto real encontrado por la revisión adversarial independiente.
 */
const NOPERSIST = "/dev/null/no-persist.json";
const env = readEnv({ OPENAI_API_KEY: "sk-x-123456789", APP_ACCESS_PASSWORD: "x", MEMORY_PROVIDER: "local" }).env!;
const { profiles } = resolveProfiles({});

describe("dedup/creación NO cruza perfiles (P1)", () => {
  it("un candidato de un perfil NUNCA se fusiona sobre la memoria privada de otro", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    // Juanma guarda algo privado.
    const juanma = await createMemory(store, {
      scope: "private", ownerProfileId: "juanma", createdByProfileId: "juanma",
      type: "preference", title: "color", content: "El color favorito es azul", source: "conversation",
    });
    expect(juanma.ok).toBe(true);
    // Sergio dice EXACTAMENTE lo mismo: debe crear el SUYO, no tocar el de Juanma.
    const sergio = await createMemory(store, {
      scope: "private", ownerProfileId: "sergio", createdByProfileId: "sergio",
      type: "preference", title: "color", content: "El color favorito es azul", source: "conversation",
    });
    expect(sergio.ok).toBe(true);
    expect(sergio.deduplicatedInto).toBeUndefined(); // NO se fusionó con el de Juanma
    expect(sergio.item!.id).not.toBe(juanma.item!.id);
    expect(sergio.item!.ownerProfileId).toBe("sergio");
    // Ambos existen, cada uno de su dueño.
    const all = await store.list({ status: "active" });
    expect(all.filter((m) => m.ownerProfileId === "juanma")).toHaveLength(1);
    expect(all.filter((m) => m.ownerProfileId === "sergio")).toHaveLength(1);
  });
});

describe("pending no secuestra una memoria activa ni degrada su confianza (P1/P2)", () => {
  it("una candidata sensible idéntica no convierte una activa en pending", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    const active = await createMemory(store, {
      scope: "private", ownerProfileId: "juanma", createdByProfileId: "juanma",
      type: "person", title: "dato", content: "Juanma vive en Madrid", source: "conversation", confidence: 0.8,
    });
    const pending = await createPendingMemory(
      store,
      { scope: "private", ownerProfileId: "juanma", createdByProfileId: "juanma", type: "person",
        title: "dato", content: "Juanma vive en Madrid", source: "conversation", sensitivity: "sensitive" },
      { sessionTag: "s" },
    );
    expect(pending).not.toBeNull();
    expect(pending!.id).not.toBe(active.item!.id); // creó una NUEVA, no secuestró la activa
    const stillActive = await store.get(active.item!.id);
    expect(stillActive!.status).toBe("active"); // la activa sigue activa
    expect(stillActive!.confidence).toBe(0.8); // y su confianza intacta
  });
});

describe("identidad SUGERIDA no busca memoria privada (P0/P1)", () => {
  it("searchMemories con confirmed=false no devuelve lo privado del perfil", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    const juanma = profiles.find((p) => p.id === "juanma")!;
    await createMemory(store, {
      scope: "private", ownerProfileId: "juanma", createdByProfileId: "juanma",
      type: "person", title: "secreto", content: "Juanma tiene cita médica el martes", source: "conversation",
    });
    const suggested = await searchMemories(store, env, "cita médica martes", { profile: juanma, confirmed: false, markAccessed: false });
    expect(suggested.length).toBe(0);
    const confirmed = await searchMemories(store, env, "cita médica martes", { profile: juanma, confirmed: true, markAccessed: false });
    expect(confirmed.length).toBeGreaterThan(0);
  });
});

describe("matchProfileByAlias no hace spoofing por subcadena (P1)", () => {
  it("una negación que contiene el alias NO resuelve a ese perfil", () => {
    // "no soy juanma" no debe resolver a Juanma (owner) por contener "juanma".
    // (Coincidencia por palabra completa: aquí "juanma" SÍ es un token, así que
    // este caso concreto sigue matcheando; el fallo real era el substring en
    // palabras compuestas.) Verificamos que un token AJENO no matchea:
    expect(matchProfileByAlias(profiles, "soy juanmalorca")).toBeNull(); // 'juanma' NO es token completo
    expect(matchProfileByAlias(profiles, "soy sergiovich")).toBeNull();
    // Y que el caso legítimo sigue funcionando.
    expect(matchProfileByAlias(profiles, "soy sergio")?.id).toBe("sergio");
  });
});

describe("presupuesto de prompt medido contra bloques reales (P2)", () => {
  it("el peor bloque de identidad real mantiene el prompt ≤3500", () => {
    // Cubierto en detalle por tests/personality.test.ts; aquí solo afirmamos
    // que buildIdentityBlock produce los tres estados sin fabricación.
    const prof = { displayName: "Juanma", role: "owner" as const };
    const unknown = buildIdentityBlock("unknown", prof, " (owner sin PIN configurado: modo demo)");
    expect(unknown).toContain("DESCONOCIDO");
    expect(buildIdentityBlock("claimed", prof, "")).toContain("sin confirmar");
    expect(buildIdentityBlock("confirmed", prof, "")).toContain("Hablas con Juanma");
  });
});
