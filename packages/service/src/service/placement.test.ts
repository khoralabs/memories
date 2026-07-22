import { describe, expect, test } from "bun:test";
import { unsupportedStorageFeature } from "../storage/core/index";
import {
  createBackendResolver,
  createInMemoryPlacementStore,
  type MemoriesDatabaseBackend,
  type MemoriesDatabaseBackendFactory,
  type MemoriesDatabaseId,
  type SqliteBackendStrategy,
} from "./index";

function createMockBackend(
  strategy: SqliteBackendStrategy,
  databases: MemoriesDatabaseId[],
): MemoriesDatabaseBackend {
  return {
    strategy,
    async open(id) {
      return {
        persistence: { ownerKey: id.ownerKey } as never,
        async close() {},
      };
    },
    async exists(id) {
      return databases.some((entry) => entry.kind === id.kind && entry.ownerKey === id.ownerKey);
    },
    async list(filter) {
      if (filter?.kind === undefined) return [...databases];
      return databases.filter((entry) => entry.kind === filter.kind);
    },
    async delete() {},
    async checkpoint() {},
    async snapshot() {
      return unsupportedStorageFeature("snapshot", strategy.kind);
    },
    async close() {},
  };
}

describe("backend resolver with placement overrides", () => {
  test("uses per-principal strategy override when present", async () => {
    const defaultStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/default",
      sqlCipherKey: "default-key",
    };
    const overrideStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/override",
      sqlCipherKey: "override-key",
    };
    const placement = createInMemoryPlacementStore({ defaultStrategy });
    const id: MemoriesDatabaseId = { kind: "account", ownerKey: "owner-a" };
    await placement.setStrategy(id, overrideStrategy);

    const factory: MemoriesDatabaseBackendFactory = {
      create(strategy) {
        const local = strategy as SqliteBackendStrategy;
        if (local.dataDir === overrideStrategy.dataDir) {
          return createMockBackend(local, [id]);
        }
        return createMockBackend(local, [{ kind: "account", ownerKey: "default-only" }]);
      },
    };

    const resolver = createBackendResolver({ placement, factory });
    const defaultBackend = await resolver.resolve({ kind: "account", ownerKey: "other" });
    const overrideBackend = await resolver.resolve(id);

    expect(defaultBackend.strategy).toEqual(defaultStrategy);
    expect(overrideBackend.strategy).toEqual(overrideStrategy);
  });

  test("list merges default backend ids with placement overrides", async () => {
    const defaultStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/default",
      sqlCipherKey: "default-key",
    };
    const overrideStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/override",
      sqlCipherKey: "override-key",
    };
    const defaultId = { kind: "account", ownerKey: "default-only" };
    const overrideId = { kind: "organization", ownerKey: "org-hosted" };
    const overrideOnlyId = { kind: "organization", ownerKey: "override-only" };

    const placement = createInMemoryPlacementStore({ defaultStrategy });
    await placement.setStrategy(overrideId, overrideStrategy);

    const factory: MemoriesDatabaseBackendFactory = {
      create(strategy) {
        const local = strategy as SqliteBackendStrategy;
        if (local.dataDir === overrideStrategy.dataDir) {
          return createMockBackend(local, [overrideId, overrideOnlyId]);
        }
        return createMockBackend(local, [defaultId]);
      },
    };

    const resolver = createBackendResolver({ placement, factory });
    const listed = await resolver.list();

    expect(listed.sort((a, b) => a.ownerKey.localeCompare(b.ownerKey))).toEqual(
      [defaultId, overrideId, overrideOnlyId].sort((a, b) => a.ownerKey.localeCompare(b.ownerKey)),
    );
  });

  test("list deduplicates ids present in both default and override backends", async () => {
    const defaultStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/default",
      sqlCipherKey: "default-key",
    };
    const overrideStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/override",
      sqlCipherKey: "override-key",
    };
    const sharedId = { kind: "account", ownerKey: "shared" };

    const placement = createInMemoryPlacementStore({ defaultStrategy });
    await placement.setStrategy(sharedId, overrideStrategy);

    const factory: MemoriesDatabaseBackendFactory = {
      create(strategy) {
        const local = strategy as SqliteBackendStrategy;
        return createMockBackend(local, [sharedId]);
      },
    };

    const resolver = createBackendResolver({ placement, factory });
    expect(await resolver.list()).toEqual([sharedId]);
  });

  test("list honors kind filter across default and override backends", async () => {
    const defaultStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/default",
      sqlCipherKey: "default-key",
    };
    const overrideStrategy: SqliteBackendStrategy = {
      kind: "sqlite",
      dataDir: "/override",
      sqlCipherKey: "override-key",
    };
    const accountDefault = { kind: "account", ownerKey: "acct-default" };
    const orgDefault = { kind: "organization", ownerKey: "org-default" };
    const orgOverride = { kind: "organization", ownerKey: "org-override" };

    const placement = createInMemoryPlacementStore({ defaultStrategy });
    await placement.setStrategy(orgOverride, overrideStrategy);

    const factory: MemoriesDatabaseBackendFactory = {
      create(strategy) {
        const local = strategy as SqliteBackendStrategy;
        if (local.dataDir === overrideStrategy.dataDir) {
          return createMockBackend(local, [orgOverride]);
        }
        return createMockBackend(local, [accountDefault, orgDefault]);
      },
    };

    const resolver = createBackendResolver({ placement, factory });
    expect(await resolver.list({ kind: "organization" })).toEqual([orgDefault, orgOverride]);
  });
});
