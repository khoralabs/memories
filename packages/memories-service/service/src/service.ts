import type { MemoriesPersistenceAsync } from "@khoralabs/memories-core/persistence";

import type { MemoriesDatabaseHandle } from "./backend";
import {
  createConnectionCache,
  deleteCachedConnection,
  getCachedConnection,
  setCachedConnection,
} from "./connection-cache";
import type { MemoriesDatabaseBackendResolver } from "./resolver";
import type { DatabaseListFilter, MemoriesDatabaseId, MemoriesDatabaseService } from "./types";
import { validateMemoriesDatabaseId } from "./validate";

export type CreateMemoriesDatabaseServiceOptions = {
  resolver: MemoriesDatabaseBackendResolver;
  maxCached?: number;
};

const DEFAULT_MAX_CACHED = 64;

export function createMemoriesDatabaseService(
  opts: CreateMemoriesDatabaseServiceOptions,
): MemoriesDatabaseService {
  const maxCached = opts.maxCached ?? DEFAULT_MAX_CACHED;
  const cache = createConnectionCache({ max: maxCached });

  async function getOrOpen(id: MemoriesDatabaseId): Promise<MemoriesDatabaseHandle> {
    const validated = validateMemoriesDatabaseId(id);
    const cached = getCachedConnection(cache, validated);
    if (cached !== undefined) return cached.handle;

    const backend = await opts.resolver.resolve(validated);
    const handle = await backend.open(validated);
    setCachedConnection(cache, validated, handle);
    return handle;
  }

  return {
    async open(id: MemoriesDatabaseId): Promise<MemoriesPersistenceAsync> {
      const handle = await getOrOpen(id);
      return handle.persistence;
    },

    async getHandle(id: MemoriesDatabaseId): Promise<MemoriesDatabaseHandle> {
      return getOrOpen(id);
    },

    async exists(id: MemoriesDatabaseId): Promise<boolean> {
      const validated = validateMemoriesDatabaseId(id);
      const backend = await opts.resolver.resolve(validated);
      return backend.exists(validated);
    },

    async list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]> {
      return opts.resolver.list(filter);
    },

    async delete(id: MemoriesDatabaseId): Promise<void> {
      const validated = validateMemoriesDatabaseId(id);
      deleteCachedConnection(cache, validated);
      const backend = await opts.resolver.resolve(validated);
      await backend.delete(validated);
    },

    async checkpoint(id: MemoriesDatabaseId): Promise<void> {
      const handle = await getOrOpen(id);
      if (handle.checkpoint !== undefined) {
        await handle.checkpoint();
        return;
      }
      const validated = validateMemoriesDatabaseId(id);
      const backend = await opts.resolver.resolve(validated);
      await backend.checkpoint(validated);
    },

    async close(id: MemoriesDatabaseId): Promise<void> {
      const validated = validateMemoriesDatabaseId(id);
      deleteCachedConnection(cache, validated);
      const backend = await opts.resolver.resolve(validated);
      await backend.close(validated);
    },
  };
}
