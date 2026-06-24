import { describe, expect, test } from "bun:test";

import { hashStoredOntology, type StoredOntologyJsonSchema } from "./ontology";
import { createInMemoryOntologyStore } from "./ontology-registry";

function schemaWithNodeKind(kind: string): StoredOntologyJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
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

describe("in-memory ontology store", () => {
  const schema = schemaWithNodeKind("fact");

  test("registerOntology is idempotent by content hash", async () => {
    const store = createInMemoryOntologyStore();
    const first = await store.registerOntology(schema);
    const second = await store.registerOntology(schema);
    expect(first.hash).toBe(second.hash);
    expect(await store.getOntology(first.hash)).toBeDefined();
  });

  test("linkDatabase appends history and getCurrentLink returns latest", async () => {
    const store = createInMemoryOntologyStore();
    const first = await store.registerOntology(schema);
    const updated = await store.registerOntology(schemaWithNodeKind("belief"));
    const id = { kind: "account", ownerKey: "owner-a" };

    await store.linkDatabase(id, first.hash);
    await store.linkDatabase(id, updated.hash);

    expect(await store.getCurrentLink(id)).toEqual({
      hash: updated.hash,
      linkedAtMs: expect.any(Number),
    });
    expect(await store.listLinkHistory(id)).toHaveLength(2);
  });

  test("listDatabasesByOntologyHash uses current link only", async () => {
    const store = createInMemoryOntologyStore();
    const first = await store.registerOntology(schema);
    const updated = await store.registerOntology(schemaWithNodeKind("belief"));
    const firstDb = { kind: "account", ownerKey: "owner-a" };
    const secondDb = { kind: "account", ownerKey: "owner-b" };

    await store.linkDatabase(firstDb, first.hash);
    await store.linkDatabase(firstDb, updated.hash);
    await store.linkDatabase(secondDb, first.hash);

    expect(await store.listDatabasesByOntologyHash(first.hash)).toEqual([secondDb]);
    expect(await store.listDatabasesByOntologyHash(updated.hash)).toEqual([firstDb]);
  });

  test("listDatabasesByLabelKinds matches current ontology shape", async () => {
    const store = createInMemoryOntologyStore();
    const factOntology = await store.registerOntology(schema);
    const beliefOntology = await store.registerOntology(schemaWithNodeKind("belief"));
    const factDb = { kind: "account", ownerKey: "fact-db" };
    const beliefDb = { kind: "account", ownerKey: "belief-db" };

    await store.linkDatabase(factDb, factOntology.hash);
    await store.linkDatabase(beliefDb, beliefOntology.hash);

    expect(await store.listDatabasesByLabelKinds({ nodeKinds: ["fact"] })).toEqual([factDb]);
    expect(await store.listDatabasesByLabelKinds({ nodeKinds: ["belief"] })).toEqual([beliefDb]);
  });

  test("descriptions produce distinct ontology hashes", async () => {
    const store = createInMemoryOntologyStore();
    const base = schemaWithNodeKind("fact");
    const described = schemaWithNodeKind("fact");
    const factSchema = described.properties.nodeLabels.properties.fact;
    expect(factSchema).toBeDefined();
    const text = (factSchema?.properties as Record<string, { description?: string }>).text;
    if (text === undefined) {
      throw new Error("expected text schema");
    }
    text.description = "Different";
    expect(hashStoredOntology(base)).not.toBe(hashStoredOntology(described));
    await store.registerOntology(base);
    await store.registerOntology(described);
  });
});
