import { LRUCache } from "lru-cache";
import type { MemoriesDatabaseHandle, MemoriesDatabaseId } from "../storage/core/index";
import { cacheKeyForId, validateMemoriesDatabaseId } from "../storage/core/index";

export type CachedConnection = {
  id: MemoriesDatabaseId;
  handle: MemoriesDatabaseHandle;
};

export type ConnectionCache = LRUCache<string, CachedConnection>;

export type EvictionCloseResult = {
  ok: boolean;
  durationMs: number;
  error?: unknown;
};

export type CreateConnectionCacheOptions = {
  max: number;
  onEvictionCloseError?: (error: unknown, entry: CachedConnection) => void;
  /** Fired after LRU eviction close settles (not for explicit {@link releaseCachedConnection}). */
  onEvicted?: (entry: CachedConnection, result: EvictionCloseResult) => void;
};

const explicitlyClosedHandles = new WeakSet<MemoriesDatabaseHandle>();

export function createConnectionCache(opts: CreateConnectionCacheOptions): ConnectionCache {
  return new LRUCache<string, CachedConnection>({
    max: opts.max,
    dispose: (entry) => {
      if (explicitlyClosedHandles.has(entry.handle)) return;
      const start = performance.now();
      void entry.handle
        .close()
        .then(() => {
          opts.onEvicted?.(entry, { ok: true, durationMs: performance.now() - start });
        })
        .catch((error) => {
          opts.onEvicted?.(entry, {
            ok: false,
            durationMs: performance.now() - start,
            error,
          });
          opts.onEvictionCloseError?.(error, entry);
        });
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

export async function releaseCachedConnection(
  cache: ConnectionCache,
  id: MemoriesDatabaseId,
): Promise<boolean> {
  const validated = validateMemoriesDatabaseId(id);
  const key = cacheKeyForId(validated);
  const entry = cache.get(key);
  if (entry === undefined) return false;

  if (entry.handle.checkpoint !== undefined) {
    await entry.handle.checkpoint();
  }
  await entry.handle.close();
  explicitlyClosedHandles.add(entry.handle);
  cache.delete(key);
  return true;
}
