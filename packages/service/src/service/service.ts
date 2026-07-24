import type { MemoriesPersistenceAsync } from "@khoralabs/memories-node/persistence";
import {
  bindMemoriesTelemetry,
  MEMORIES_DATABASE_KIND_ATTR,
  MEMORIES_DATABASE_OWNER_KEY_ATTR,
  type MemoriesTelemetry,
  runWithDatabaseLifecycleAsync,
} from "@khoralabs/memories-node/telemetry";
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
  /** Structured telemetry for database lifecycle and (via handle) node ops. */
  telemetry?: MemoriesTelemetry;
  onLifecycleError?: (
    error: unknown,
    context: { id: MemoriesDatabaseId; operation: "close" | "delete" | "release" },
  ) => void;
  onEvictionCloseError?: (error: unknown, context: { id: MemoriesDatabaseId }) => void;
};

const DEFAULT_MAX_CACHED = 64;

function bindDatabaseTelemetry(
  telemetry: MemoriesTelemetry | undefined,
  id: MemoriesDatabaseId,
): MemoriesTelemetry | undefined {
  if (telemetry === undefined) return undefined;
  return bindMemoriesTelemetry(telemetry, {
    [MEMORIES_DATABASE_KIND_ATTR]: id.kind,
    [MEMORIES_DATABASE_OWNER_KEY_ATTR]: id.ownerKey,
  });
}

function withHandleTelemetry(
  handle: MemoriesDatabaseHandle,
  telemetry: MemoriesTelemetry | undefined,
): MemoriesDatabaseHandle {
  if (telemetry === undefined) return handle;
  return { ...handle, telemetry };
}

export function createMemoriesDatabaseService(
  opts: CreateMemoriesDatabaseServiceOptions,
): MemoriesDatabaseService {
  const maxCached = opts.maxCached ?? DEFAULT_MAX_CACHED;
  const rootTelemetry = opts.telemetry;

  const cache = createConnectionCache({
    max: maxCached,
    onEvicted: (entry, result) => {
      rootTelemetry?.emitDatabaseLifecycle({
        operation: "evict",
        ok: result.ok,
        durationMs: result.durationMs,
        databaseKind: entry.id.kind,
        databaseOwnerKey: entry.id.ownerKey,
        ...(result.error !== undefined
          ? { error: result.error instanceof Error ? result.error.message : String(result.error) }
          : {}),
      });
    },
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

    const bound = bindDatabaseTelemetry(rootTelemetry, validated);
    const handle = await runWithDatabaseLifecycleAsync({
      telemetry: rootTelemetry,
      operation: "open",
      databaseKind: validated.kind,
      databaseOwnerKey: validated.ownerKey,
      fn: async () => {
        const backend = await opts.resolver.resolve(validated);
        const opened = await backend.open(validated);
        return withHandleTelemetry(opened, bound);
      },
    });
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
        await runWithDatabaseLifecycleAsync({
          telemetry: rootTelemetry,
          operation: "delete",
          databaseKind: validated.kind,
          databaseOwnerKey: validated.ownerKey,
          fn: async () => {
            await releaseCachedHandle(validated);
            const backend = await opts.resolver.resolve(validated);
            await backend.delete(validated);
          },
        });
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
        await runWithDatabaseLifecycleAsync({
          telemetry: rootTelemetry,
          operation: "close",
          databaseKind: validated.kind,
          databaseOwnerKey: validated.ownerKey,
          fn: async () => {
            await releaseCachedHandle(validated);
            const backend = await opts.resolver.resolve(validated);
            await backend.close(validated);
          },
        });
      } catch (error) {
        opts.onLifecycleError?.(error, { id: validated, operation: "close" });
        throw error;
      }
    },
  };
}
