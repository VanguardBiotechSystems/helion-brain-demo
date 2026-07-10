import { describe, expect, it } from "vitest";
import { LocalMemoryStore } from "@/lib/server/memory/localStore";
import {
  archiveInactiveProfiles,
  restoreProfile,
  listProfilesForOwner,
  mergeProfiles,
} from "@/lib/server/memory/profileLifecycle";

const NOPERSIST = "/dev/null/no-persist.json";
const DAY = 86_400_000;

describe("ciclo de vida de perfiles dinámicos (sección 9)", () => {
  it("registra creación y último uso", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    await store.recordProfileUsage({ id: "ana", displayName: "Ana", role: "visitor", origin: "dynamic" });
    const list = await listProfilesForOwner(store);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "ana", origin: "dynamic", status: "active", pinned: false });
  });

  it("archiva dinámicos inactivos >30 días; NUNCA los fijados ni los known", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    await store.recordProfileUsage({ id: "ana", displayName: "Ana", role: "visitor", origin: "dynamic" });
    await store.recordProfileUsage({ id: "juanma", displayName: "Juanma", role: "owner", origin: "known" });
    // Envejece a Ana 40 días.
    const result = await archiveInactiveProfiles(store, Date.now() + 40 * DAY);
    expect(result.archived).toContain("ana");
    expect(result.archived).not.toContain("juanma"); // known/pinned intacto
    const list = await listProfilesForOwner(store);
    expect(list.find((p) => p.id === "ana")?.status).toBe("archived");
    expect(list.find((p) => p.id === "juanma")?.status).toBe("active");
  });

  it("un perfil archivado se puede restaurar y reactivar por uso", async () => {
    const store = new LocalMemoryStore(NOPERSIST);
    await store.recordProfileUsage({ id: "ana", displayName: "Ana", role: "visitor", origin: "dynamic" });
    await store.setProfileStatus("ana", "archived");
    await restoreProfile(store, "ana");
    expect((await listProfilesForOwner(store)).find((p) => p.id === "ana")?.status).toBe("active");
    // Volver a usarlo también lo reactiva.
    await store.setProfileStatus("ana", "archived");
    await store.recordProfileUsage({ id: "ana", displayName: "Ana", role: "visitor", origin: "dynamic" });
    expect((await listProfilesForOwner(store)).find((p) => p.id === "ana")?.status).toBe("active");
  });

  it("la fusión de perfiles es un contrato documentado, no una operación silenciosa", async () => {
    await expect(mergeProfiles()).rejects.toThrow(/no está implementada/);
  });
});
