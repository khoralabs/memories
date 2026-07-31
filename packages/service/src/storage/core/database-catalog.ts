import type { DatabaseListFilter, MemoriesDatabaseId } from "./database-id";
import { databaseKey, parseDatabaseKey } from "./database-key";
import { validateMemoriesDatabaseId } from "./validate";

/** Catalog attributes for a logical database (not part of {@link MemoriesDatabaseId}). */
export type MemoriesDatabaseMetadata = {
  name: string;
  description: string;
};

export type MemoriesDatabaseCatalogEntry = MemoriesDatabaseMetadata & {
  id: MemoriesDatabaseId;
  updatedAtMs: number;
};

export type MemoriesDatabaseCatalogStore = {
  get(id: MemoriesDatabaseId): Promise<MemoriesDatabaseMetadata | undefined>;
  upsert(
    id: MemoriesDatabaseId,
    patch: { name?: string; description?: string },
  ): Promise<MemoriesDatabaseMetadata>;
  remove(id: MemoriesDatabaseId): Promise<void>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseCatalogEntry[]>;
};

export function createInMemoryDatabaseCatalogStore(): MemoriesDatabaseCatalogStore {
  const rows = new Map<string, MemoriesDatabaseCatalogEntry>();

  return {
    async get(id) {
      const validated = validateMemoriesDatabaseId(id);
      const entry = rows.get(databaseKey(validated));
      return entry === undefined ? undefined : { name: entry.name, description: entry.description };
    },
    async upsert(id, patch) {
      const validated = validateMemoriesDatabaseId(id);
      const key = databaseKey(validated);
      const existing = rows.get(key);
      const name = patch.name !== undefined ? patch.name : (existing?.name ?? "");
      const description =
        patch.description !== undefined ? patch.description : (existing?.description ?? "");
      const entry: MemoriesDatabaseCatalogEntry = {
        id: validated,
        name,
        description,
        updatedAtMs: Date.now(),
      };
      rows.set(key, entry);
      return { name: entry.name, description: entry.description };
    },
    async remove(id) {
      rows.delete(databaseKey(validateMemoriesDatabaseId(id)));
    },
    async list(filter) {
      const out: MemoriesDatabaseCatalogEntry[] = [];
      for (const [key, entry] of rows) {
        const id = parseDatabaseKey(key);
        if (id === undefined) continue;
        if (filter?.kind !== undefined && id.kind !== filter.kind) continue;
        out.push(entry);
      }
      return out;
    },
  };
}
