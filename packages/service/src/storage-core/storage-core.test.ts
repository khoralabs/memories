import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LIBSQL_STRATEGY_CAPABILITIES,
  DEFAULT_SQLITE_STRATEGY_CAPABILITIES,
  databaseKey,
  parseDatabaseKey,
  resolveStrategyCapabilities,
  serializeStrategy,
  UnsupportedStorageFeatureError,
  unsupportedStorageFeature,
} from "./index";

describe("storage-core strategies", () => {
  test("resolveStrategyCapabilities uses sqlite defaults and overrides", () => {
    expect(
      resolveStrategyCapabilities({
        kind: "sqlite",
        dataDir: "/data",
        capabilities: { vectorSearch: false },
      }),
    ).toEqual({ ...DEFAULT_SQLITE_STRATEGY_CAPABILITIES, vectorSearch: false });
  });

  test("resolveStrategyCapabilities uses libsql defaults", () => {
    expect(
      resolveStrategyCapabilities({
        kind: "libsql",
        dataDir: "/data",
      }),
    ).toEqual(DEFAULT_LIBSQL_STRATEGY_CAPABILITIES);
  });

  test("serializeStrategy preserves strategy kind and JSON payload", () => {
    const serialized = serializeStrategy({ kind: "turso-serverless", url: "libsql://db" });
    expect(serialized.kind).toBe("turso-serverless");
    expect(JSON.parse(serialized.json)).toEqual({ kind: "turso-serverless", url: "libsql://db" });
  });
});

describe("storage-core database keys", () => {
  test("databaseKey and parseDatabaseKey roundtrip validated ids", () => {
    const id = { kind: "account", ownerKey: "owner-a" };
    expect(parseDatabaseKey(databaseKey(id))).toEqual(id);
  });
});

describe("storage-core unsupported features", () => {
  test("unsupportedStorageFeature throws a typed error", () => {
    expect(() => unsupportedStorageFeature("snapshot", "sqlite")).toThrow(
      UnsupportedStorageFeatureError,
    );
  });
});
