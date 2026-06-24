import { describe, expect, test } from "bun:test";
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
  label: string,
): MemoriesDatabaseBackend {
  return {
    strategy,
    async open(id) {
      return {
        persistence: { label: `${label}:${id.ownerKey}` } as never,
        async close() {},
      };
    },
    async exists() {
      return true;
    },
    async list() {
      return [];
    },
    async delete() {},
    async checkpoint() {},
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
        return createMockBackend(
          local,
          local.dataDir === overrideStrategy.dataDir ? "override" : "default",
        );
      },
    };

    const resolver = createBackendResolver({ placement, factory });
    const defaultBackend = await resolver.resolve({ kind: "account", ownerKey: "other" });
    const overrideBackend = await resolver.resolve(id);

    expect(defaultBackend.strategy).toEqual(defaultStrategy);
    expect(overrideBackend.strategy).toEqual(overrideStrategy);
  });
});
