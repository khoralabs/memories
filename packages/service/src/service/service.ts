import type { MemoriesPersistenceAsync } from "@khoralabs/memories-node/persistence";
import type {
  DatabaseListFilter,
  MemoriesDatabaseHandle,
  MemoriesDatabaseId,
  MemoriesDatabaseSnapshot,
} from "../storage/core/index";
import { validateMemoriesDatabaseId } from "../storage/core/index";

import {
  createConnectionCache,
  getCachedConnection,
  releaseCachedConnection,
  setCachedConnection,
} from "./connection-cache";
import type { MemoriesDatabaseBackendResolver } from "./resolver";
import type { MemoriesDatabaseService } from "./types";

export type CreateMemoriesDatabaseServiceOptions = {
  resolver: MemoriesDatabaseBackendResolver;
  maxCached?: number;
  onLifecycleError?: (
    error: unknown,
    context: { id: MemoriesDatabaseId; operation: "close" | "delete" | "release" },
  ) => void;
  onEvictionCloseError?: (error: unknown, context: { id: MemoriesDatabaseId }) => void;
};

const DEFAULT_MAX_CACHED = 64;

export function createMemoriesDatabaseService(
  opts: CreateMemoriesDatabaseServiceOptions,
): MemoriesDatabaseService {
  const maxCached = opts.maxCached ?? DEFAULT_MAX_CACHED;
  const cache = createConnectionCache({
    max: maxCached,
    onEvictionCloseError: (error, entry) => {
      opts.onEvictionCloseError?.(error, { id: entry.id });
    },
  });

  async function releaseCachedHandle(id: MemoriesDatabaseId): Promise<void> {
    await releaseCachedConnection(cache, id);
  }

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
      try {
        await releaseCachedHandle(validated);
        const backend = await opts.resolver.resolve(validated);
        await backend.delete(validated);
      } catch (error) {
        opts.onLifecycleError?.(error, { id: validated, operation: "delete" });
        throw error;
      }
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

    async snapshot(id: MemoriesDatabaseId): Promise<MemoriesDatabaseSnapshot> {
      const validated = validateMemoriesDatabaseId(id);
      const backend = await opts.resolver.resolve(validated);
      return backend.snapshot(validated);
    },

    async close(id: MemoriesDatabaseId): Promise<void> {
      const validated = validateMemoriesDatabaseId(id);
      try {
        await releaseCachedHandle(validated);
        const backend = await opts.resolver.resolve(validated);
        await backend.close(validated);
      } catch (error) {
        opts.onLifecycleError?.(error, { id: validated, operation: "close" });
        throw error;
      }
    },
  };
}
