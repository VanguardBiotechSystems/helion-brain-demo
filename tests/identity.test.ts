import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchGatePasscode, matchProfileByAlias, resolveProfiles, getProfileById, type AccessProfile } from "@/lib/server/profiles";
import { canProfileAccessMemory, detectScopeCues, filterMemoriesForProfile, filterMemoriesForRetrieval } from "@/lib/server/memory/permissions";
import { migrateLegacyScopes, type MemoryItem } from "@/lib/server/memory/types";
import { containsSecret } from "@/lib/server/memory/redaction";
import { validateCuratorOutput } from "@/lib/server/memory/curator";
import { buildSelfKnowledgeBlock } from "@/lib/server/memory/selfKnowledge";
import { LocalMemoryStore } from "@/lib/server/memory/localStore";
import { createMemory, buildSessionMemoryContext } from "@/lib/server/memory/service";
import { readEnv } from "@/lib/server/env";

const juanma: AccessProfile = { id: "juanma", displayName: "Juanma", role: "owner", aliases: ["juanma"], trustLevel: "owner", requiresPin: true, memoryScopes: ["project", "project_demo", "public", "system_self", "safety"], canManageMemory: true, canViewDebug: true, canCreateProjectMemory: true };
const sergio: AccessProfile = { id: "sergio", displayName: "Sergio", role: "robot_creator", aliases: ["sergio"], trustLevel: "project_member", requiresPin: false, memoryScopes: ["project", "project_demo", "public", "system_self", "safety"], canManageMemory: false, canViewDebug: false, canCreateProjectMemory: true };
const visitante: AccessProfile = { id: "guest", displayName: "Visitante", role: "visitor", aliases: ["visitante"], trustLevel: "visitor", requiresPin: false, memoryScopes: ["project_demo", "public", "system_self"], canManageMemory: false, canViewDebug: false, canCreateProjectMemory: false };

function mem(scope: MemoryItem["scope"], owner: string | null = null): MemoryItem {
  const now = new Date().toISOString();
  return { id: `m${Math.random()}`, profileId: "default", scope, visibility: "shared", ownerProfileId: owner, createdByProfileId: owner, allowedProfileIds: [], type: "semantic", assertionType: "unclassified", title: "t", content: "c", canonicalContent: "c", summary: "", embedding: null, importance: 0.8, confidence: 0.9, source: "conversation", sensitivity: "normal", status: "active", tags: [], relatedEntities: [], createdAt: now, updatedAt: now, lastAccessedAt: null, accessCount: 0, expiresAt: null, provenance: {}, version: 1 };
}

describe("puerta de acceso e identidad conversacional", () => {
  it("el passcode general abre la puerta pero NO asigna identidad", () => {
    const { env } = readEnv({ OPENAI_API_KEY: "sk-t-123456789", APP_ACCESS_PASSWORD: "demo" });
    expect(matchGatePasscode(env!.gatePasscodes, "demo")).toBe(true);
    expect(matchGatePasscode(env!.gatePasscodes, "mal")).toBe(false);
    // Los perfiles conocidos existen por identidad, no por passcode:
    expect(env!.profiles.map((p) => p.id)).toContain("juanma");
    expect(env!.profiles.map((p) => p.id)).toContain("sergio");
  });
  it("'Soy Sergio' resuelve el perfil sergio; 'soy un inversor' el de inversor", () => {
    const { profiles } = resolveProfiles({});
    expect(matchProfileByAlias(profiles, "Soy Sergio")?.id).toBe("sergio");
    expect(matchProfileByAlias(profiles, "soy sergio, el del robot")?.id).toBe("sergio");
    expect(matchProfileByAlias(profiles, "soy un inversor")?.id).toBe("investor");
    expect(matchProfileByAlias(profiles, "soy Juanma")?.id).toBe("juanma");
    expect(matchProfileByAlias(profiles, "soy nadie conocido xyz")).toBeNull();
  });
  it("el owner exige PIN (requiresPin) y KNOWN_PROFILES_JSON extiende alias", () => {
    const { profiles, error } = resolveProfiles({ KNOWN_PROFILES_JSON: '[{"id":"juanma","aliases":["juan manuel gomez"]}]' });
    expect(error).toBeNull();
    const juanmaP = profiles.find((p) => p.id === "juanma")!;
    expect(juanmaP.requiresPin).toBe(true);
    expect(matchProfileByAlias(profiles, "soy juan manuel gomez")?.id).toBe("juanma");
  });
  it("perfiles dinámicos: persona nueva = visitante con su propia memoria", () => {
    const { profiles } = resolveProfiles({});
    const pablo = getProfileById(profiles, "pablo", true);
    expect(pablo?.role).toBe("visitor");
    expect(getProfileById(profiles, "pablo", false)).toBeNull();
  });
});

describe("permisos de memoria por scope", () => {
  it("privada de Juanma: invisible para Sergio, visible para Juanma", () => {
    const m = mem("private", "juanma");
    expect(canProfileAccessMemory(m, juanma)).toBe(true);
    expect(canProfileAccessMemory(m, sergio)).toBe(false);
    expect(canProfileAccessMemory(m, visitante)).toBe(false);
  });
  it("project: Juanma y Sergio sí; visitante no", () => {
    const m = mem("project");
    expect(canProfileAccessMemory(m, juanma)).toBe(true);
    expect(canProfileAccessMemory(m, sergio)).toBe(true);
    expect(canProfileAccessMemory(m, visitante)).toBe(false);
  });
  it("public para todos; internal para nadie", () => {
    expect(canProfileAccessMemory(mem("public"), visitante)).toBe(true);
    expect(canProfileAccessMemory(mem("internal"), juanma)).toBe(false);
  });
  it("filterMemoriesForProfile filtra en bloque", () => {
    const items = [mem("private", "juanma"), mem("project"), mem("public")];
    expect(filterMemoriesForProfile(items, sergio)).toHaveLength(2);
  });
});

describe("pistas explícitas de alcance", () => {
  it("clasifica solo-para-mí / proyecto / compartible / confidencial", () => {
    expect(detectScopeCues("recuerda esto solo para mí")).toEqual({ scope: "private", confidential: false });
    expect(detectScopeCues("guárdalo para el proyecto")).toEqual({ scope: "project", confidential: false });
    expect(detectScopeCues("esto puedes contárselo a Sergio")).toEqual({ scope: "project", confidential: false });
    expect(detectScopeCues("no se lo digas a Sergio")).toEqual({ scope: "private", confidential: true });
    expect(detectScopeCues("mañana hay demo")).toEqual({ scope: null, confidential: false });
  });
});

describe("migración de memorias antiguas", () => {
  it("seeds → project_demo/safety; resto → private del owner", () => {
    const legacy = { ...mem("private"), scope: undefined } as unknown as MemoryItem;
    const seed = migrateLegacyScopes({ ...legacy, source: "system", type: "safety" }, "juanma");
    expect(seed.scope).toBe("safety");
    const user = migrateLegacyScopes({ ...legacy, source: "conversation" }, "juanma");
    expect(user.scope).toBe("private");
    expect(user.ownerProfileId).toBe("juanma");
  });
});

describe("seguridad y autoconocimiento", () => {
  it("la redacción bloquea DATABASE_URL", () => {
    expect(containsSecret("postgres://user:pass@host/db")).toBe(true);
  });
  it("el curador exige proposedScope válido", () => {
    const base = { shouldRemember: true, memoryType: "preference", title: "t", canonicalContent: "contenido útil", importance: 0.8, confidence: 0.9, sensitivity: "normal", tags: [], relatedEntities: [], updateCandidates: [], contradictionCandidates: [], requiresUserConfirmation: false, reason: "r" };
    expect(validateCuratorOutput({ memories: [{ ...base, proposedScope: "private" }] })[0].proposedScope).toBe("private");
    expect(validateCuratorOutput({ memories: [{ ...base, proposedScope: "inventado" }] })[0].proposedScope).toBe("project_demo");
  });
  it("el bloque de autoconocimiento no contiene secretos ni nombra proveedor", () => {
    const { env } = readEnv({ OPENAI_API_KEY: "sk-test-123456789", APP_ACCESS_PASSWORD: "x", VOICE_ENGINE: "elevenlabs", ELEVENLABS_API_KEY: "clave-secreta-el", ELEVENLABS_VOICE_ID: "voz1" });
    const block = buildSelfKnowledgeBlock(env!, true);
    expect(block).toContain("persistente");
    expect(block).toContain("PROHIBIDO revelar");
    expect(block).not.toContain("sk-test");
    expect(block).not.toContain("clave-secreta-el");
    // Blindaje: nunca revela la tecnología que hay debajo.
    expect(block).not.toContain("ElevenLabs");
    expect(block).not.toContain("OpenAI");
  });
});

describe("persistencia real e inyección filtrada", () => {
  it("otra instancia del store lee lo guardado (persistencia en disco)", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "helion-id-")), "m.json");
    const a = new LocalMemoryStore(path);
    await a.init();
    await createMemory(a, { scope: "project", createdByProfileId: "juanma", type: "project", title: "Creador", content: "El creador del robot se llama Sergio.", importance: 0.9, source: "explicit_user_request" }, {});
    const b = new LocalMemoryStore(path); // "reinicio" del servidor
    await b.init();
    const items = await b.list();
    expect(items).toHaveLength(1);
    expect(items[0].content).toContain("Sergio");
  });
  it("el contexto de sesión excluye lo privado de otros", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "helion-ctx-")), "m.json");
    const store = new LocalMemoryStore(path);
    await store.init();
    await createMemory(store, { scope: "private", ownerProfileId: "juanma", createdByProfileId: "juanma", type: "preference", title: "secreto", content: "Juanma no quiere que Sergio sepa lo del prototipo B.", importance: 0.9, source: "explicit_user_request" }, {});
    await createMemory(store, { scope: "project", createdByProfileId: "juanma", type: "project", title: "placa", content: "El robot usa una placa Jetson.", importance: 0.9, source: "explicit_user_request" }, {});
    const { env } = readEnv({ OPENAI_API_KEY: "sk-t-123456789", APP_ACCESS_PASSWORD: "x" });
    const forSergio = await buildSessionMemoryContext(store, env!, sergio);
    expect(forSergio).toContain("Jetson");
    expect(forSergio).not.toContain("prototipo B");
    const forJuanma = await buildSessionMemoryContext(store, env!, juanma);
    expect(forJuanma).toContain("prototipo B");
  });
});

describe("identidad sugerida y aislamiento entre perfiles (bloque 2)", () => {
  it("una identidad SUGERIDA (sin confirmar) no abre lo privado ni lo de proyecto", async () => {
    const store = new LocalMemoryStore("/dev/null/no-persist.json");
    const items = [mem("private", "juanma"), mem("project"), mem("project_demo"), mem("public"), mem("system_self")];
    const restricted = filterMemoriesForRetrieval(items, juanma, false); // NO confirmado
    const scopes = restricted.map((m) => m.scope).sort();
    expect(scopes).toEqual(["project_demo", "public", "system_self"]);
    // Confirmado sí abre lo suyo.
    const full = filterMemoriesForRetrieval(items, juanma, true);
    expect(full.map((m) => m.scope)).toContain("private");
    void store;
  });

  it("cero fugas: lo privado de Juanma NUNCA llega a Sergio, ni confirmado", () => {
    const juanmaPrivate = mem("private", "juanma");
    expect(filterMemoriesForRetrieval([juanmaPrivate], sergio, true)).toHaveLength(0);
    expect(filterMemoriesForProfile([juanmaPrivate], sergio)).toHaveLength(0);
  });

  it("el técnico no ve memoria privada de nadie", () => {
    const tecnico: AccessProfile = {
      id: "tecnico", displayName: "Técnico", role: "technician", aliases: ["tecnico"], trustLevel: "technician",
      requiresPin: false, memoryScopes: ["project_demo", "public", "system_self"],
      canManageMemory: false, canViewDebug: false, canCreateProjectMemory: false,
    };
    const items = [mem("private", "juanma"), mem("project"), mem("project_demo")];
    const visible = filterMemoriesForProfile(items, tecnico).map((m) => m.scope);
    expect(visible).toEqual(["project_demo"]);
  });
});
