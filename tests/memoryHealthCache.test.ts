import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/server/env";
import { getMemoryHealth, memoryHealthComputeCount } from "@/lib/server/memory/service";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("salud de memoria fuera del camino crítico", () => {
  it("la caché TTL evita recomputar en llamadas consecutivas", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "helion-h-")), "m.json");
    const { env } = readEnv({ OPENAI_API_KEY: "sk-x-123456789", APP_ACCESS_PASSWORD: "x", MEMORY_LOCAL_PATH: path });
    const before = memoryHealthComputeCount();
    const a = await getMemoryHealth(env!);
    const afterFirst = memoryHealthComputeCount();
    const b = await getMemoryHealth(env!);
    const c = await getMemoryHealth(env!);
    expect(afterFirst).toBe(before + 1);
    expect(memoryHealthComputeCount()).toBe(afterFirst); // 2ª y 3ª: caché
    expect(b).toBe(a);
    expect(c).toBe(a);
    // maxAgeMs=0 fuerza recomputar (stale bajo demanda)
    await getMemoryHealth(env!, 0);
    expect(memoryHealthComputeCount()).toBe(afterFirst + 1);
  });
});
