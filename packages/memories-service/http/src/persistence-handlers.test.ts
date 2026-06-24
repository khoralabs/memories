import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-core";
import { MemoriesClient } from "@khoralabs/memories-core";
import { createNoneAuthStrategy } from "@khoralabs/memories-service-auth";
import { createRemoteMemoriesClientAsync } from "@khoralabs/memories-service-client";
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";

import { handleMemoriesServiceHttpRequest } from "./handlers";

const tempDirs: string[] = [];

const testOntology: OntologyDefinition<LabelSchemaMap, LabelSchemaMap> = {
  nodeLabels: {},
  edgeLabels: {},
};

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-service-http-"));
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

async function postJson(url: string, body: unknown, service = createTestStack().service) {
  return handleMemoriesServiceHttpRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { service, auth: createNoneAuthStrategy() },
  );
}

describe("memories service persistence http handlers", () => {
  test("search, merge, delete, provenance, capabilities", async () => {
    const { service } = createTestStack();
    const database = { kind: "account", ownerKey: "owner-a" };
    await service.open(database);

    const mergeRes = await postJson(
      "http://localhost/databases/merge",
      {
        database,
        params: {
          kind: "node",
          key: "note-1",
          namespace: "user/a",
          content: [{ key: "text", text: "hello world" }],
          labels: [],
        },
      },
      service,
    );
    expect(mergeRes.status).toBe(200);

    const searchRes = await postJson(
      "http://localhost/databases/search",
      {
        database,
        params: {
          namespace: "user/a",
          content: { text: "hello" },
          options: { topK: 5, arms: { lexical: 1, vector: 0 } },
        },
      },
      service,
    );
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as { hits: unknown[] };
    expect(searchBody.hits.length).toBeGreaterThan(0);

    const capsRes = await postJson(
      "http://localhost/databases/capabilities",
      { database },
      service,
    );
    expect(capsRes.status).toBe(200);

    const provRes = await postJson(
      "http://localhost/databases/provenance/head",
      { database },
      service,
    );
    expect(provRes.status).toBe(200);

    const deleteRes = await postJson(
      "http://localhost/databases/delete-memory",
      { database, namespace: "user/a", key: "note-1" },
      service,
    );
    expect(deleteRes.status).toBe(200);
  });

  test("sqlite read endpoints", async () => {
    const stack = createTestStack();
    const { service } = stack;
    const database = { kind: "account", ownerKey: "owner-reads" };
    const handle = await service.getHandle(database);
    const sqlite = handle.sqlite;
    if (sqlite === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sqlite.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "graph node" }],
      labels: [],
    });

    const namespacesRes = await postJson(
      "http://localhost/databases/namespaces",
      { database },
      service,
    );
    expect(namespacesRes.status).toBe(200);
    const namespacesBody = (await namespacesRes.json()) as { namespaces: string[] };
    expect(namespacesBody.namespaces).toContain("ns/a");

    const graphRes = await postJson(
      "http://localhost/databases/graph",
      { database, namespace: "ns/a", scope: "exact" },
      service,
    );
    expect(graphRes.status).toBe(200);

    const dimsRes = await postJson(
      "http://localhost/databases/vector-dimensions",
      { database },
      service,
    );
    expect(dimsRes.status).toBe(200);
  });
});

describe("remote memories client over http", () => {
  test("createRemoteMemoriesClientAsync proxies search and merge", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "remote-owner" };
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          auth: createNoneAuthStrategy(),
        });
      },
    });

    try {
      const client = await createRemoteMemoriesClientAsync({
        baseUrl: `http://localhost:${server.port}`,
        database,
        ontology: testOntology,
      });

      await client.mergeMemory({
        kind: "node",
        key: "remote-note",
        namespace: "user/remote",
        content: [{ key: "text", text: "remote hello" }],
        labels: [],
      });

      const hits = await client.search({
        namespace: "user/remote",
        content: { text: "remote" },
        options: { topK: 3, arms: { lexical: 1, vector: 0 } },
      });
      expect(hits.length).toBeGreaterThan(0);

      await client.deleteMemory({ namespace: "user/remote", key: "remote-note" });
    } finally {
      server.stop(true);
    }
  });
});
