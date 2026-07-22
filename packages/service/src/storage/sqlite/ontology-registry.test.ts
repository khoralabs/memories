import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import {
  normalizeStoredOntologyJsonSchema,
  type StoredOntologyJsonSchema,
} from "../../storage/core/index";

import { createSqliteOntologyStore } from "./ontology-registry";

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

/** Durability across reopen. Ontology CRUD / queries live in the shared contract suite. */
describe("sqlite ontology registry", () => {
  test("persists ontologies and append-only link history across reopen", async () => {
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
});
