import { describe, expect, test } from "bun:test";
import type {
  MemoriesDatabaseOntologyStore,
  StoredOntologyJsonSchema,
} from "../storage-core/index";
import { hashStoredOntology, STORED_ONTOLOGY_JSON_SCHEMA_URI } from "../storage-core/index";

export type MemoriesDatabaseOntologyStoreContractFactory = () =>
  | MemoriesDatabaseOntologyStore
  | Promise<MemoriesDatabaseOntologyStore>;

function schemaWithNodeKind(kind: string, description?: string): StoredOntologyJsonSchema {
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
            properties: {
              text: {
                type: "string",
                ...(description === undefined ? {} : { description }),
              },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      edgeLabels: {
        type: "object",
        additionalProperties: false,
        properties: {
          relates_to: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
    },
    required: ["nodeLabels", "edgeLabels"],
    additionalProperties: false,
  };
}

export function runMemoriesDatabaseOntologyStoreContractTests(
  name: string,
  create: MemoriesDatabaseOntologyStoreContractFactory,
): void {
  describe(`${name} ontology store contract`, () => {
    test("registerOntology is idempotent; descriptions affect hash", async () => {
      const store = await create();
      const base = schemaWithNodeKind("fact");
      const described = schemaWithNodeKind("fact", "Different description");

      const first = await store.registerOntology(base);
      const second = await store.registerOntology(base);
      const third = await store.registerOntology(described);

      expect(first.hash).toBe(second.hash);
      expect(first.hash).toBe(hashStoredOntology(base));
      expect(first.hash).not.toBe(third.hash);
      expect(await store.getOntology(first.hash)).toBeDefined();
    });

    test("linkDatabase appends history; current link is latest", async () => {
      const store = await create();
      const first = await store.registerOntology(schemaWithNodeKind("fact"));
      const second = await store.registerOntology(schemaWithNodeKind("belief"));
      const id = {
        kind: "account",
        ownerKey: `ontology-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };

      await store.linkDatabase(id, first.hash);
      await store.linkDatabase(id, second.hash);

      expect(await store.getCurrentLink(id)).toMatchObject({ hash: second.hash });
      const history = await store.listLinkHistory(id);
      expect(history).toHaveLength(2);
      expect(history.map((row) => row.hash)).toEqual([first.hash, second.hash]);
    });

    test("linkDatabase throws for unknown ontology hash", async () => {
      const store = await create();
      const id = {
        kind: "account",
        ownerKey: `ontology-unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      await expect(store.linkDatabase(id, "missing-hash")).rejects.toThrow(/Unknown ontology hash/);
    });

    test("shape queries use current link across databases", async () => {
      const store = await create();
      const fact = await store.registerOntology(schemaWithNodeKind("fact"));
      const belief = await store.registerOntology(schemaWithNodeKind("belief"));
      const factDb = {
        kind: "account",
        ownerKey: `fact-db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const beliefDb = {
        kind: "account",
        ownerKey: `belief-db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };

      await store.linkDatabase(factDb, fact.hash);
      await store.linkDatabase(beliefDb, belief.hash);
      await store.linkDatabase(factDb, belief.hash);
      await store.linkDatabase(factDb, fact.hash);

      expect(await store.listDatabasesByOntologyHash(fact.hash)).toEqual([factDb]);
      expect(await store.listDatabasesByOntologyHash(belief.hash)).toEqual([beliefDb]);
      expect(await store.listDatabasesByLabelKinds({ nodeKinds: ["belief"] })).toEqual([beliefDb]);
    });
  });
}
