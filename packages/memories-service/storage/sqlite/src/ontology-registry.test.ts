import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  normalizeStoredOntologyJsonSchema,
  type StoredOntologyJsonSchema,
} from "@khoralabs/memories-service";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import { createSqliteOntologyStore } from "./ontology-registry";
import { createLocalSqliteServiceStack } from "./stack";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-ontology-registry-"));
  tempDirs.push(dir);
  return dir;
}

function schemaWithNodeKind(kind: string, description?: string): StoredOntologyJsonSchema {
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

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("sqlite ontology registry", () => {
  test("persists ontologies and append-only link history", async () => {
    const dataDir = makeTempDataDir();
    const registryPath = path.join(dataDir, "registry", "ontologies.db");
    const store = createSqliteOntologyStore({
      registryPath,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    const schema = schemaWithNodeKind("fact", "Fact text");
    const { hash } = await store.registerOntology(schema);
    const id = { kind: "account", ownerKey: "owner-a" };
    await store.linkDatabase(id, hash);

    const reloaded = createSqliteOntologyStore({
      registryPath,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    expect(await reloaded.getOntology(hash)).toEqual(normalizeStoredOntologyJsonSchema(schema));
    expect(await reloaded.getCurrentLink(id)).toEqual({
      hash,
      linkedAtMs: expect.any(Number),
    });
    expect(await reloaded.listLinkHistory(id)).toHaveLength(1);
  });

  test("registerOntology is idempotent and descriptions affect hash", async () => {
    const dataDir = makeTempDataDir();
    const store = createSqliteOntologyStore({
      registryPath: path.join(dataDir, "registry", "ontologies.db"),
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    const base = schemaWithNodeKind("fact");
    const described = schemaWithNodeKind("fact", "Different description");

    const first = await store.registerOntology(base);
    const second = await store.registerOntology(base);
    const third = await store.registerOntology(described);

    expect(first.hash).toBe(second.hash);
    expect(first.hash).not.toBe(third.hash);
  });

  test("shape queries use current link across databases", async () => {
    const dataDir = makeTempDataDir();
    const { ontology } = createLocalSqliteServiceStack({
      dataDir,
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
    const fact = await ontology.registerOntology(schemaWithNodeKind("fact"));
    const belief = await ontology.registerOntology(schemaWithNodeKind("belief"));
    const factDb = { kind: "account", ownerKey: "fact-db" };
    const beliefDb = { kind: "account", ownerKey: "belief-db" };

    await ontology.linkDatabase(factDb, fact.hash);
    await ontology.linkDatabase(beliefDb, belief.hash);
    await ontology.linkDatabase(factDb, belief.hash);
    await ontology.linkDatabase(factDb, fact.hash);

    expect(await ontology.listDatabasesByOntologyHash(fact.hash)).toEqual([factDb]);
    expect(await ontology.listDatabasesByLabelKinds({ nodeKinds: ["belief"] })).toEqual([beliefDb]);
  });
});
