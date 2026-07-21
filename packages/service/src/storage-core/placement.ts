import type { MemoriesDatabaseBackendStrategy } from "./backend";
import type { DatabaseListFilter, MemoriesDatabaseId } from "./database-id";
import { databaseKey, parseDatabaseKey } from "./database-key";

export type MemoriesDatabasePlacementStore = {
  getDefaultStrategy(): Promise<MemoriesDatabaseBackendStrategy>;
  setDefaultStrategy(strategy: MemoriesDatabaseBackendStrategy): Promise<void>;
  getStrategy(id: MemoriesDatabaseId): Promise<MemoriesDatabaseBackendStrategy | undefined>;
  setStrategy(id: MemoriesDatabaseId, strategy: MemoriesDatabaseBackendStrategy): Promise<void>;
  removeStrategy(id: MemoriesDatabaseId): Promise<void>;
  listOverrides(
    filter?: DatabaseListFilter,
  ): Promise<Array<{ id: MemoriesDatabaseId; strategy: MemoriesDatabaseBackendStrategy }>>;
};

export type InMemoryPlacementStoreOptions = {
  defaultStrategy: MemoriesDatabaseBackendStrategy;
};

export function createInMemoryPlacementStore(
  opts: InMemoryPlacementStoreOptions,
): MemoriesDatabasePlacementStore {
  let defaultStrategy = opts.defaultStrategy;
  const overrides = new Map<string, MemoriesDatabaseBackendStrategy>();

  return {
    async getDefaultStrategy() {
      return defaultStrategy;
    },
    async setDefaultStrategy(strategy) {
      defaultStrategy = strategy;
    },
    async getStrategy(id) {
      return overrides.get(databaseKey(id));
    },
    async setStrategy(id, strategy) {
      overrides.set(databaseKey(id), strategy);
    },
    async removeStrategy(id) {
      overrides.delete(databaseKey(id));
    },
    async listOverrides(filter) {
      const entries: Array<{ id: MemoriesDatabaseId; strategy: MemoriesDatabaseBackendStrategy }> =
        [];
      for (const [key, strategy] of overrides) {
        const id = parseDatabaseKey(key);
        if (id === undefined) continue;
        if (filter?.kind !== undefined && id.kind !== filter.kind) continue;
        entries.push({ id, strategy });
      }
      return entries;
    },
  };
}
