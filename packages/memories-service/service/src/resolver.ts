import { LRUCache } from "lru-cache";

import {
  type MemoriesDatabaseBackend,
  type MemoriesDatabaseBackendFactory,
  strategyCacheKey,
} from "./backend";
import type { MemoriesDatabasePlacementStore } from "./placement";
import type { DatabaseListFilter, MemoriesDatabaseId } from "./types";
import { cacheKeyForId } from "./validate";

export type MemoriesDatabaseBackendResolver = {
  resolve(id: MemoriesDatabaseId): Promise<MemoriesDatabaseBackend>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]>;
};

export type CreateBackendResolverOptions = {
  placement: MemoriesDatabasePlacementStore;
  factory: MemoriesDatabaseBackendFactory;
  backendCacheSize?: number;
};

function addListedDatabase(
  seen: Set<string>,
  results: MemoriesDatabaseId[],
  id: MemoriesDatabaseId,
): void {
  const key = cacheKeyForId(id);
  if (seen.has(key)) return;
  seen.add(key);
  results.push(id);
}

export function createBackendResolver(
  opts: CreateBackendResolverOptions,
): MemoriesDatabaseBackendResolver {
  const backendCache = new LRUCache<string, MemoriesDatabaseBackend>({
    max: opts.backendCacheSize ?? 32,
  });

  async function backendForStrategy(
    strategy: Parameters<MemoriesDatabaseBackendFactory["create"]>[0],
  ): Promise<MemoriesDatabaseBackend> {
    const key = strategyCacheKey(strategy);
    const cached = backendCache.get(key);
    if (cached !== undefined) return cached;
    const backend = opts.factory.create(strategy);
    backendCache.set(key, backend);
    return backend;
  }

  return {
    async resolve(id) {
      const strategy =
        (await opts.placement.getStrategy(id)) ?? (await opts.placement.getDefaultStrategy());
      return backendForStrategy(strategy);
    },
    async list(filter) {
      const defaultStrategy = await opts.placement.getDefaultStrategy();
      const defaultBackend = await backendForStrategy(defaultStrategy);
      const defaultStrategyKey = strategyCacheKey(defaultStrategy);

      const seen = new Set<string>();
      const results: MemoriesDatabaseId[] = [];

      for (const id of await defaultBackend.list(filter)) {
        addListedDatabase(seen, results, id);
      }

      const overrides = await opts.placement.listOverrides(filter);
      const overrideStrategies = new Map<string, (typeof overrides)[number]["strategy"]>();

      for (const override of overrides) {
        addListedDatabase(seen, results, override.id);
        const strategyKey = strategyCacheKey(override.strategy);
        if (strategyKey !== defaultStrategyKey) {
          overrideStrategies.set(strategyKey, override.strategy);
        }
      }

      for (const strategy of overrideStrategies.values()) {
        const backend = await backendForStrategy(strategy);
        for (const id of await backend.list(filter)) {
          addListedDatabase(seen, results, id);
        }
      }

      return results;
    },
  };
}
