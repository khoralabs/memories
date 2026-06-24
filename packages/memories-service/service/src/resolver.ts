import { LRUCache } from "lru-cache";

import {
  type MemoriesDatabaseBackend,
  type MemoriesDatabaseBackendFactory,
  strategyCacheKey,
} from "./backend";
import type { MemoriesDatabasePlacementStore } from "./placement";
import type { DatabaseListFilter, MemoriesDatabaseId } from "./types";

export type MemoriesDatabaseBackendResolver = {
  resolve(id: MemoriesDatabaseId): Promise<MemoriesDatabaseBackend>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]>;
};

export type CreateBackendResolverOptions = {
  placement: MemoriesDatabasePlacementStore;
  factory: MemoriesDatabaseBackendFactory;
  backendCacheSize?: number;
};

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
      const strategy = await opts.placement.getDefaultStrategy();
      const backend = await backendForStrategy(strategy);
      return backend.list(filter);
    },
  };
}
