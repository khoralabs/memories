import { LRUCache } from "lru-cache";

import type { MemoriesDatabaseHandle } from "./backend";
import type { MemoriesDatabaseId } from "./types";
import { cacheKeyForId } from "./validate";

export type CachedConnection = {
  id: MemoriesDatabaseId;
  handle: MemoriesDatabaseHandle;
};

export type ConnectionCache = LRUCache<string, CachedConnection>;

export type CreateConnectionCacheOptions = {
  max: number;
};

export function createConnectionCache(opts: CreateConnectionCacheOptions): ConnectionCache {
  return new LRUCache<string, CachedConnection>({
    max: opts.max,
    dispose: (entry) => {
      void entry.handle.close().catch(() => undefined);
    },
  });
}

export function getCachedConnection(
  cache: ConnectionCache,
  id: MemoriesDatabaseId,
): CachedConnection | undefined {
  return cache.get(cacheKeyForId(id));
}

export function setCachedConnection(
  cache: ConnectionCache,
  id: MemoriesDatabaseId,
  handle: MemoriesDatabaseHandle,
): void {
  cache.set(cacheKeyForId(id), { id, handle });
}

export function deleteCachedConnection(cache: ConnectionCache, id: MemoriesDatabaseId): void {
  cache.delete(cacheKeyForId(id));
}
