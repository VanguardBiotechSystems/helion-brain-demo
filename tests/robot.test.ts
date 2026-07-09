import { describe, expect, it } from "vitest";
import { MockRobotAdapter } from "@/lib/robot/mockAdapter";
import type { RobotCommand } from "@/lib/robot/types";

function command(type: RobotCommand["type"]): RobotCommand {
  return { id: `cmd-${type}`, type, params: {}, issuedAt: Date.now(), source: "agent" };
}

describe("MockRobotAdapter", () => {
  it("no declara hardware conectado", () => {
    const adapter = new MockRobotAdapter();
    expect(adapter.isHardwareConnected()).toBe(false);
  });

  it("todas las capacidades están marcadas como no disponibles", () => {
    const adapter = new MockRobotAdapter();
    for (const capability of adapter.capabilities()) {
      expect(capability.available).toBe(false);
    }
  });

  it("simula gestos conocidos sin ejecutarlos", async () => {
    const adapter = new MockRobotAdapter();
    const result = await adapter.execute(command("WAVE_HAND"));
    expect(result.status).toBe("simulated");
    expect(result.detail).toContain("WAVE_HAND");
  });

  it("nunca devuelve status 'executed'", async () => {
    const adapter = new MockRobotAdapter();
    for (const capability of adapter.capabilities()) {
      const result = await adapter.execute(command(capability.command));
      expect(result.status).not.toBe("executed");
    }
  });

  it("rechaza comandos desconocidos", async () => {
    const adapter = new MockRobotAdapter();
    const result = await adapter.execute({
      ...command("WAVE_HAND"),
      type: "SELF_DESTRUCT" as RobotCommand["type"],
    });
    expect(result.status).toBe("rejected");
  });

  it("notifica a los suscriptores y permite cancelar la suscripción", async () => {
    const adapter = new MockRobotAdapter();
    const seen: string[] = [];
    const unsubscribe = adapter.subscribe((cmd, result) => {
      seen.push(`${cmd.type}:${result.status}`);
    });

    await adapter.execute(command("MOVE_HEAD"));
    expect(seen).toEqual(["MOVE_HEAD:simulated"]);

    unsubscribe();
    await adapter.execute(command("STOP_ALL"));
    expect(seen).toHaveLength(1);
  });
});
