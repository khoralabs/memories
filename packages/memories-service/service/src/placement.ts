import type { MemoriesDatabaseBackendStrategy } from "./backend";
import type { DatabaseListFilter, MemoriesDatabaseId } from "./types";

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

  function overrideKey(id: MemoriesDatabaseId): string {
    return `${id.kind}\0${id.ownerKey}`;
  }

  return {
    async getDefaultStrategy() {
      return defaultStrategy;
    },
    async setDefaultStrategy(strategy) {
      defaultStrategy = strategy;
    },
    async getStrategy(id) {
      return overrides.get(overrideKey(id));
    },
    async setStrategy(id, strategy) {
      overrides.set(overrideKey(id), strategy);
    },
    async removeStrategy(id) {
      overrides.delete(overrideKey(id));
    },
    async listOverrides(filter) {
      const entries: Array<{ id: MemoriesDatabaseId; strategy: MemoriesDatabaseBackendStrategy }> =
        [];
      for (const [key, strategy] of overrides) {
        const [kind, ownerKey] = key.split("\0");
        if (kind === undefined || ownerKey === undefined) continue;
        if (filter?.kind !== undefined && filter.kind !== kind) continue;
        entries.push({ id: { kind, ownerKey }, strategy });
      }
      return entries;
    },
  };
}
