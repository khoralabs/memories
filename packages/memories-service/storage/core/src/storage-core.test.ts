import { describe, expect, test } from "bun:test";
import {
  createInMemoryOntologyStore,
  createInMemoryPlacementStore,
  DEFAULT_SQLITE_STRATEGY_CAPABILITIES,
  databaseKey,
  hashStoredOntology,
  parseDatabaseKey,
  resolveStrategyCapabilities,
  STORED_ONTOLOGY_JSON_SCHEMA_URI,
  type StoredOntologyJsonSchema,
  serializeStrategy,
  UnsupportedStorageFeatureError,
  unsupportedStorageFeature,
} from "./index";

function schemaWithNodeKind(kind: string): StoredOntologyJsonSchema {
  return {
    $schema: STORED_ONTOLOGY_JSON_SCHEMA_URI,
    type: "object",
    properties: {
      nodeLabels: {
        type: "object",
        additionalProperties: false,
        properties: {
          [kind]: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      edgeLabels: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    required: ["nodeLabels", "edgeLabels"],
    additionalProperties: false,
  };
}

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

describe("storage-core in-memory stores", () => {
  test("placement store returns overrides and default strategy", async () => {
    const defaultStrategy = { kind: "sqlite", dataDir: "/default" } as const;
    const overrideStrategy = { kind: "turso-serverless", url: "libsql://db" } as const;
    const store = createInMemoryPlacementStore({ defaultStrategy });
    const id = { kind: "account", ownerKey: "owner-a" };

    expect(await store.getDefaultStrategy()).toEqual(defaultStrategy);
    await store.setStrategy(id, overrideStrategy);
    expect(await store.getStrategy(id)).toEqual(overrideStrategy);
    expect(await store.listOverrides({ kind: "account" })).toEqual([
      { id, strategy: overrideStrategy },
    ]);
  });

  test("ontology store tracks current links by ontology hash", async () => {
    const store = createInMemoryOntologyStore();
    const first = await store.registerOntology(schemaWithNodeKind("fact"));
    const second = await store.registerOntology(schemaWithNodeKind("belief"));
    const id = { kind: "account", ownerKey: "owner-a" };

    await store.linkDatabase(id, first.hash);
    await store.linkDatabase(id, second.hash);

    expect(hashStoredOntology(schemaWithNodeKind("fact"))).toBe(first.hash);
    expect(await store.listDatabasesByOntologyHash(first.hash)).toEqual([]);
    expect(await store.listDatabasesByOntologyHash(second.hash)).toEqual([id]);
  });
});

describe("storage-core unsupported features", () => {
  test("unsupportedStorageFeature throws a typed error", () => {
    expect(() => unsupportedStorageFeature("snapshot", "sqlite")).toThrow(
      UnsupportedStorageFeatureError,
    );
  });
});
