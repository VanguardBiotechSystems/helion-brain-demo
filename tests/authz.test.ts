import { describe, expect, it } from "vitest";
import { can, identityPlane, activeCapabilities, canRetrievePrivate, type Capability } from "@/lib/server/authz";
import type { AccessProfile, IdentityStatus, ProfileRole } from "@/lib/server/profiles";

// can()/identityPlane() solo dependen de profile.role: perfiles sintéticos.
function prof(role: ProfileRole): AccessProfile {
  return {
    id: role, displayName: role, aliases: [role], role, trustLevel: "visitor",
    memoryScopes: [], canManageMemory: false, canViewDebug: false,
    canCreateProjectMemory: false, requiresPin: role === "owner",
  };
}

const ALL_CAPS: Capability[] = [
  "read_private_memory", "read_project_memory", "create_project_memory", "manage_memory",
  "view_debug", "view_tech_status", "admin_profiles", "consolidate_memory",
];

describe("matriz de autorización centralizada (sección 8)", () => {
  // Matriz esperada por (rol, capacidad) en su MÁXIMO plano de identidad.
  const EXPECT: Record<ProfileRole, Capability[]> = {
    owner: ALL_CAPS,
    robot_creator: ["read_private_memory", "read_project_memory", "create_project_memory", "view_tech_status"],
    technician: ["view_tech_status"],
    team: ["read_private_memory", "read_project_memory", "create_project_memory"],
    investor: [],
    visitor: [],
  };

  for (const role of Object.keys(EXPECT) as ProfileRole[]) {
    for (const cap of ALL_CAPS) {
      const shouldHave = EXPECT[role].includes(cap);
      it(`${role} ${shouldHave ? "puede" : "NO puede"} ${cap} (en su plano máximo)`, () => {
        // owner alcanza "privileged" con confirmed; el resto "confirmed".
        const status: IdentityStatus = "confirmed";
        expect(can(prof(role), status, cap)).toBe(shouldHave);
      });
    }
  }

  it("el técnico ve estado técnico pero NUNCA memoria privada ni herramientas de owner", () => {
    const tech = prof("technician");
    expect(can(tech, "confirmed", "view_tech_status")).toBe(true);
    expect(can(tech, "confirmed", "read_private_memory")).toBe(false);
    expect(can(tech, "confirmed", "manage_memory")).toBe(false);
    expect(can(tech, "confirmed", "view_debug")).toBe(false);
    expect(can(tech, "confirmed", "admin_profiles")).toBe(false);
  });
});

describe("planos de identidad (sección 7)", () => {
  it("desconocido = access; sugerido no abre lo privado", () => {
    const owner = prof("owner");
    expect(identityPlane(owner, "unknown")).toBe("access");
    expect(identityPlane(owner, "claimed")).toBe("suggested");
    expect(canRetrievePrivate(owner, "claimed")).toBe(false);
    expect(canRetrievePrivate(owner, "unknown")).toBe(false);
  });

  it("owner confirmado = privileged (step-up); sugerido no", () => {
    const owner = prof("owner");
    expect(identityPlane(owner, "confirmed")).toBe("privileged");
    expect(can(owner, "confirmed", "view_debug")).toBe(true);
    expect(can(owner, "claimed", "view_debug")).toBe(false);
    expect(can(owner, "claimed", "manage_memory")).toBe(false);
  });

  it("un rol no-owner confirmado abre lo suyo pero no capacidades privilegiadas", () => {
    const sergio = prof("robot_creator");
    expect(identityPlane(sergio, "confirmed")).toBe("confirmed");
    expect(canRetrievePrivate(sergio, "confirmed")).toBe(true);
    expect(can(sergio, "confirmed", "manage_memory")).toBe(false);
    expect(can(sergio, "confirmed", "admin_profiles")).toBe(false);
  });

  it("activeCapabilities de un visitante confirmado está vacío", () => {
    expect(activeCapabilities(prof("visitor"), "confirmed")).toEqual([]);
  });
});
