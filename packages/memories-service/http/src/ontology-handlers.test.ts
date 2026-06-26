import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-ontologies";
import { createNoneAuthStrategy } from "@khoralabs/memories-service-auth";
import {
  ensureDatabaseOntologyLink,
  MemoriesOntologyClient,
  MemoriesServiceClient,
  storedOntologyFromDefinition,
} from "@khoralabs/memories-service-client";
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import { handleMemoriesServiceHttpRequest } from "./handlers";

const tempDirs: string[] = [];

const testOntology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap> = {
  nodeLabels: {},
  edgeLabels: {},
};
const testSchema = storedOntologyFromDefinition(testOntology, { title: "test ontology" });

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-ontology-http-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function createTestStack() {
  return createLocalSqliteServiceStack({
    dataDir: makeTempDataDir(),
    sqlCipherKey: TEST_SQLCIPHER_KEY,
  });
}

async function postJson(url: string, body: unknown, stack = createTestStack()) {
  return handleMemoriesServiceHttpRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { service: stack.service, ontology: stack.ontology, auth: createNoneAuthStrategy() },
  );
}

describe("ontology http handlers", () => {
  test("register, link, current, history, and discovery", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "ontology-owner" };

    const registerRes = await postJson(
      "http://localhost/ontologies/register",
      { schema: testSchema },
      stack,
    );
    expect(registerRes.status).toBe(200);
    const { hash } = (await registerRes.json()) as { hash: string };
    expect(hash.length).toBeGreaterThan(0);

    const getRes = await postJson("http://localhost/ontologies/get", { hash }, stack);
    expect(getRes.status).toBe(200);

    const linkRes = await postJson(
      "http://localhost/databases/ontology/link",
      { database, hash },
      stack,
    );
    expect(linkRes.status).toBe(200);

    const currentRes = await postJson(
      "http://localhost/databases/ontology/current",
      { database },
      stack,
    );
    expect(currentRes.status).toBe(200);
    const currentBody = (await currentRes.json()) as {
      link: { hash: string; linkedAtMs: number } | null;
    };
    expect(currentBody.link?.hash).toBe(hash);

    const hashRes = await postJson("http://localhost/databases/hash", { database }, stack);
    expect(hashRes.status).toBe(200);
    expect(await hashRes.json()).toEqual({ database, hash });

    const unlinked = { kind: "account", ownerKey: "unlinked" };
    const unlinkedHashRes = await postJson(
      "http://localhost/databases/hash",
      { database: unlinked },
      stack,
    );
    expect(unlinkedHashRes.status).toBe(200);
    expect(await unlinkedHashRes.json()).toEqual({ database: unlinked, hash: null });

    const historyRes = await postJson(
      "http://localhost/databases/ontology/history",
      { database },
      stack,
    );
    expect(historyRes.status).toBe(200);
    const historyBody = (await historyRes.json()) as {
      history: Array<{ hash: string }>;
    };
    expect(historyBody.history.length).toBe(1);

    const byHashRes = await postJson("http://localhost/ontologies/databases", { hash }, stack);
    expect(byHashRes.status).toBe(200);
    const byHashBody = (await byHashRes.json()) as {
      databases: Array<{ kind: string; ownerKey: string }>;
    };
    expect(byHashBody.databases).toEqual([database]);
  });

  test("ensureDatabaseOntologyLink registers and links over HTTP", async () => {
    const stack = createTestStack();
    const database = { kind: "organization", ownerKey: "org-ontology" };
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          ontology: stack.ontology,
          auth: createNoneAuthStrategy(),
        });
      },
    });

    try {
      const serviceClient = new MemoriesServiceClient({
        baseUrl: `http://localhost:${server.port}`,
      });
      const first = await ensureDatabaseOntologyLink({
        serviceClient,
        database,
        schema: testSchema,
      });
      expect(first.linked).toBe(true);

      const second = await ensureDatabaseOntologyLink({
        serviceClient,
        database,
        schema: testSchema,
      });
      expect(second.linked).toBe(false);
      expect(second.hash).toBe(first.hash);

      const ontologyClient = new MemoriesOntologyClient({ serviceClient });
      const current = await ontologyClient.getCurrentLink(database);
      expect(current?.hash).toBe(first.hash);
      await expect(ontologyClient.getDatabaseHash(database)).resolves.toBe(first.hash);
    } finally {
      server.stop(true);
    }
  });
});
