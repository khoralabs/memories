import { describe, expect, test } from "bun:test";
import { unsupportedStorageFeature } from "../storage-core/index";
import type {
  MemoriesDatabaseBackend,
  MemoriesDatabaseBackendFactory,
  MemoriesDatabaseBackendStrategy,
} from "./backend";
import { createCompositeBackendFactory, UnknownBackendStrategyError } from "./backend-factory";
import { createInMemoryPlacementStore } from "./placement";
import { createBackendResolver } from "./resolver";

function backendFor(
  strategy: MemoriesDatabaseBackendStrategy,
  listed: Array<{ kind: string; ownerKey: string }> = [],
): MemoriesDatabaseBackend {
  return {
    strategy,
    async open() {
      throw new Error("open not used in backend factory tests");
    },
    async exists() {
      return false;
    },
    async list(filter) {
      return listed.filter((id) => filter?.kind === undefined || filter.kind === id.kind);
    },
    async delete() {},
    async checkpoint() {},
    async snapshot() {
      return unsupportedStorageFeature("snapshot", strategy.kind);
    },
    async close() {},
  };
}

function recordingFactory(
  kind: string,
  listed: Array<{ kind: string; ownerKey: string }> = [],
): MemoriesDatabaseBackendFactory & { seen: MemoriesDatabaseBackendStrategy[] } {
  const seen: MemoriesDatabaseBackendStrategy[] = [];
  return {
    seen,
    create(strategy) {
      seen.push(strategy);
      if (strategy.kind !== kind) {
        throw new Error(`factory ${kind} received ${strategy.kind}`);
      }
      return backendFor(strategy, listed);
    },
  };
}

describe("createCompositeBackendFactory", () => {
  test("routes sqlite default and turso override from one placement registry", async () => {
    const sqlite = recordingFactory("sqlite", [{ kind: "account", ownerKey: "local" }]);
    const turso = recordingFactory("turso-serverless");
    const factory = createCompositeBackendFactory({
      sqlite,
      "turso-serverless": turso,
    });
    const remote = { kind: "account", ownerKey: "remote" };
    const placement = createInMemoryPlacementStore({
      defaultStrategy: { kind: "sqlite", dataDir: "/tmp/memories", sqlCipherKey: "secret" },
    });
    await placement.setStrategy(remote, {
      kind: "turso-serverless",
      url: "libsql://remote.turso.io",
      authToken: "token",
    });

    const resolver = createBackendResolver({ placement, factory });
    const defaultBackend = await resolver.resolve({ kind: "account", ownerKey: "local" });
    const remoteBackend = await resolver.resolve(remote);

    expect(defaultBackend.strategy.kind).toBe("sqlite");
    expect(remoteBackend.strategy.kind).toBe("turso-serverless");
    expect(await resolver.list({ kind: "account" })).toEqual([
      { kind: "account", ownerKey: "local" },
      remote,
    ]);
  });

  test("routes turso default and sqlite override from one placement registry", async () => {
    const sqlite = recordingFactory("sqlite");
    const turso = recordingFactory("turso-serverless");
    const factory = createCompositeBackendFactory({
      sqlite,
      "turso-serverless": turso,
    });
    const local = { kind: "account", ownerKey: "local" };
    const placement = createInMemoryPlacementStore({
      defaultStrategy: { kind: "turso-serverless", url: "libsql://{ownerKey}.turso.io" },
    });
    await placement.setStrategy(local, {
      kind: "sqlite",
      dataDir: "/tmp/memories",
      sqlCipherKey: "secret",
    });

    const resolver = createBackendResolver({ placement, factory });
    const defaultBackend = await resolver.resolve({ kind: "account", ownerKey: "remote" });
    const localBackend = await resolver.resolve(local);

    expect(defaultBackend.strategy.kind).toBe("turso-serverless");
    expect(localBackend.strategy.kind).toBe("sqlite");
  });

  test("throws for unknown strategy kinds", () => {
    const factory = createCompositeBackendFactory({});
    expect(() => factory.create({ kind: "unknown" })).toThrow(UnknownBackendStrategyError);
  });
});
