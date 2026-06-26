import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoriesClient } from "@khoralabs/memories-core";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-ontologies";
import { decodeUmapInput, UMAP_INPUT_ENCODING_HEADER } from "@khoralabs/memories-projections";
import { createNoneAuthStrategy } from "@khoralabs/memories-service-auth";
import {
  createRemoteMemoriesClientAsync,
  createRemoteMemoriesReadClient,
} from "@khoralabs/memories-service-client";
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

function createFakeProjectionSource() {
  return {
    async listNamespacesUnderPrefix(prefix: string) {
      return [prefix];
    },
    async loadMeanEmbeddingsForNamespace() {
      return [{ memoryId: "m1", memoryKey: "n1", embedding: [1, 0, 0] }];
    },
    async loadMemoryTextPreview() {
      return null;
    },
    async loadSourceMapTextPreview() {
      return null;
    },
  };
}

describe("memories service persistence http handlers", () => {
  test("search, merge, delete, provenance, capabilities", async () => {
    const stack = createTestStack();
    const { service } = stack;
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
      stack,
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
      stack,
    );
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as { hits: Array<{ id: string }> };
    expect(searchBody.hits.length).toBeGreaterThan(0);

    const previewRes = await postJson(
      "http://localhost/databases/source-map/text-preview",
      { database, sourceMapId: searchBody.hits[0]?.id },
      stack,
    );
    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as { text: string | null };
    expect(previewBody.text).toContain("hello world");

    const capsRes = await postJson("http://localhost/databases/capabilities", { database }, stack);
    expect(capsRes.status).toBe(200);

    const provRes = await postJson(
      "http://localhost/databases/provenance/head",
      { database },
      stack,
    );
    expect(provRes.status).toBe(200);

    const deleteRes = await postJson(
      "http://localhost/databases/delete-memory",
      { database, namespace: "user/a", key: "note-1" },
      stack,
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
      stack,
    );
    expect(namespacesRes.status).toBe(200);
    const namespacesBody = (await namespacesRes.json()) as { namespaces: string[] };
    expect(namespacesBody.namespaces).toContain("ns/a");

    const scopeChainRes = await postJson(
      "http://localhost/databases/ensure-scope-chain",
      { database, scopePaths: ["team", "team/project"] },
      stack,
    );
    expect(scopeChainRes.status).toBe(200);

    const dimsRes = await postJson(
      "http://localhost/databases/vector-dimensions",
      { database },
      stack,
    );
    expect(dimsRes.status).toBe(200);
  });

  test("merge endpoint ignores client-supplied attribution while service attribution is deferred", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-no-spoof" };
    await stack.service.open(database);

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
          attribution: {
            contributor: {
              v: 1,
              format: "khora.direct-principal-v1",
              principal: "did:key:z-spoof",
              payload: "eyJ2IjoxfQ",
              signature: "c2ln",
            },
            intentSnapshotId: "client-run-1",
          },
        },
      },
      stack,
    );
    expect(mergeRes.status).toBe(200);

    const handle = await stack.service.getHandle(database);
    const sqlite = handle.sqlite;
    if (sqlite === undefined) throw new Error("expected sqlite handle");
    const row = sqlite.db
      .query<{ event_json: string; intent_snapshot_id: string | null }, []>(
        `SELECT event_json, intent_snapshot_id FROM memory_provenance LIMIT 1`,
      )
      .get();
    const event = JSON.parse(row?.event_json ?? "{}") as { contributor?: unknown };
    expect(event.contributor).toBeUndefined();
    expect(row?.intent_snapshot_id).toBeNull();
  });

  test("umap input endpoint requires projection source", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-no-projection" };

    const res = await postJson(
      "http://localhost/databases/projections/umap-input",
      { database, namespace: "ns/a" },
      stack,
    );

    expect(res.status).toBe(501);
  });

  test("umap input endpoint returns compressed projection input", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-projection" };
    const handle = await stack.service.getHandle(database);
    const sqlite = handle.sqlite;
    if (sqlite === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sqlite.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "projection node" }],
      labels: [],
    });

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/projections/umap-input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          namespace: "ns/a",
          includeProvenanceHead: true,
        }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
        projectionSource: createFakeProjectionSource,
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get(UMAP_INPUT_ENCODING_HEADER)).toBe("gzip");
    const input = await decodeUmapInput(await res.arrayBuffer(), { compression: "gzip" });
    expect(input.namespace).toBe("ns/a");
    expect(input.embeddings[0]?.memoryKey).toBe("n1");
    expect(input.provenanceHeadRootHex).toBeDefined();
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
          ontology: stack.ontology,
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

  test("read client fetches and decodes umap input", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "remote-projection" };
    const handle = await stack.service.getHandle(database);
    const sqlite = handle.sqlite;
    if (sqlite === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sqlite.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "remote projection" }],
      labels: [],
    });

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return handleMemoriesServiceHttpRequest(req, {
          service: stack.service,
          ontology: stack.ontology,
          auth: createNoneAuthStrategy(),
          projectionSource: createFakeProjectionSource,
        });
      },
    });

    try {
      const reads = createRemoteMemoriesReadClient({
        baseUrl: `http://localhost:${server.port}`,
        database,
        ontology: testOntology,
      });
      const input = await reads.fetchUmapInput({ namespace: "ns/a" });
      expect(input.embeddings[0]?.memoryKey).toBe("n1");
    } finally {
      server.stop(true);
    }
  });
});
