import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logError, logInfo } from "../log";
import type {
  MemoryEvent,
  MemoryItem,
  MemoryListFilter,
  MemoryRelation,
  MemoryStore,
} from "./types";

/**
 * Almacén local en un archivo JSON. Pensado para desarrollo y para
 * servidores con disco persistente (Render/Railway). En plataformas
 * serverless (Vercel) el sistema de archivos es efímero: la memoria
 * funciona pero no sobrevive a los redespliegues — para producción usa
 * MEMORY_PROVIDER=postgres (ver docs/MEMORY_ARCHITECTURE.md).
 */

interface LocalData {
  items: MemoryItem[];
  relations: MemoryRelation[];
  events: MemoryEvent[];
}

export class LocalMemoryStore implements MemoryStore {
  readonly provider = "local" as const;
  private items = new Map<string, MemoryItem>();
  private relations: MemoryRelation[] = [];
  private events: MemoryEvent[] = [];
  private persistable = true;
  private persistWarned = false;

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as LocalData;
      for (const item of data.items ?? []) this.items.set(item.id, item);
      this.relations = data.relations ?? [];
      this.events = data.events ?? [];
      logInfo("memory", `Memoria local cargada: ${this.items.size} recuerdos (${this.filePath})`);
    } catch {
      // Archivo inexistente o ilegible: se parte de cero.
    }
  }

  private async persist(): Promise<void> {
    if (!this.persistable) return;
    const data: LocalData = {
      items: [...this.items.values()],
      relations: this.relations,
      events: this.events.slice(-2000),
    };
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(data, null, 1), "utf8");
      await rename(tmpPath, this.filePath);
    } catch (error) {
      this.persistable = false;
      if (!this.persistWarned) {
        this.persistWarned = true;
        logError(
          "memory",
          "No se puede escribir el archivo de memoria (¿sistema de archivos de solo lectura?). " +
            "La memoria seguirá en RAM de esta instancia; usa MEMORY_PROVIDER=postgres en producción.",
          error,
        );
      }
    }
  }

  async count(): Promise<number> {
    return this.items.size;
  }

  async get(id: string): Promise<MemoryItem | null> {
    return this.items.get(id) ?? null;
  }

  async create(item: MemoryItem): Promise<MemoryItem> {
    this.items.set(item.id, item);
    await this.persist();
    return item;
  }

  async update(id: string, patch: Partial<MemoryItem>): Promise<MemoryItem | null> {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated: MemoryItem = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };
    this.items.set(id, updated);
    await this.persist();
    return updated;
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryItem[]> {
    const status = filter.status ?? "active";
    const limit = filter.limit ?? 500;
    let result = [...this.items.values()];
    if (status !== "all") result = result.filter((item) => item.status === status);
    if (filter.type) result = result.filter((item) => item.type === filter.type);
    if (filter.query) {
      const q = filter.query.toLowerCase();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.content.toLowerCase().includes(q) ||
          item.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return result
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  async addRelation(relation: MemoryRelation): Promise<void> {
    this.relations.push(relation);
    await this.persist();
  }

  async logEvent(event: MemoryEvent): Promise<void> {
    this.events.push(event);
    await this.persist();
  }

  async listEvents(memoryId?: string, limit = 100): Promise<MemoryEvent[]> {
    const events = memoryId ? this.events.filter((event) => event.memoryId === memoryId) : this.events;
    return events.slice(-limit).reverse();
  }
}
