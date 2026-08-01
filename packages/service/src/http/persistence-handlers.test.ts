import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoriesClient } from "@khoralabs/memories-node";
import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import {
  decodeProjectionInput,
  PROJECTION_INPUT_ENCODING_HEADER,
} from "@khoralabs/memories-node/projections/projection-input";
import { getMemoriesSqliteDatabase } from "@khoralabs/memories-node/sqlite";
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createNoneAuthStrategy } from "../auth/index";
import { createRemoteMemoriesClientAsync, createRemoteMemoriesReadClient } from "../client/index";
import { createLocalSqliteServiceStack } from "../storage/sqlite/index";

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
  const open = () =>
    createLocalSqliteServiceStack({
      dataDir: makeTempDataDir(),
      sqlCipherKey: TEST_SQLCIPHER_KEY,
    });
  try {
    return open();
  } catch (e) {
    // First open can race: custom libsqlite vs SQLCipher setCustomSQLite.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/SQLite already loaded/i.test(msg)) throw e;
    return open();
  }
}

async function postJson(url: string, body: unknown, stack = createTestStack()) {
  return handleMemoriesServiceHttpRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    {
      service: stack.service,
      ontology: stack.ontology,
      catalog: stack.catalog,
      auth: createNoneAuthStrategy(),
    },
  );
}

function createFakeProjectionSource() {
  return {
    async listNamespacesUnderPrefix(prefix: string) {
      return [prefix];
    },
    async loadMeanEmbeddingsForNamespace(
      _namespace: string,
      opts?: { includeSuppressed?: boolean },
    ) {
      const rows = [
        { memoryId: "m1", memoryKey: "n1", embedding: [1, 0, 0] },
        {
          memoryId: "m-hub",
          memoryKey: "hub",
          embedding: [0, 1, 0],
          ...(opts?.includeSuppressed === true ? { suppressed: true as const } : {}),
        },
      ];
      if (opts?.includeSuppressed === true) return rows;
      return rows.filter((r) => r.memoryKey !== "hub");
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
  }, 15_000);

  test("sqlite read endpoints", async () => {
    const stack = createTestStack();
    const { service } = stack;
    const database = { kind: "account", ownerKey: "owner-reads" };
    const handle = await service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sync.syncPersistence, testOntology).mergeMemory({
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
    const namespacesBody = (await namespacesRes.json()) as {
      namespaces: Array<{ namespace: string; alias: string | null; description: string }>;
    };
    expect(namespacesBody.namespaces.some((n) => n.namespace === "ns/a")).toBe(true);

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
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const row = getMemoriesSqliteDatabase(sync.syncPersistence)
      .query<{ event_json: string; intent_snapshot_id: string | null }, []>(
        `SELECT event_json, intent_snapshot_id FROM memory_provenance LIMIT 1`,
      )
      .get();
    const event = JSON.parse(row?.event_json ?? "{}") as { contributor?: unknown };
    expect(event.contributor).toBeUndefined();
    expect(row?.intent_snapshot_id).toBeNull();
  });

  test("configured HTTP attribution writes khora.http-request-v1 contributor into merge provenance", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-http-attr-merge" };
    await stack.service.open(database);

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "note-attr",
            namespace: "user/attr",
            content: [{ key: "text", text: "attributed" }],
            labels: [],
          },
        }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
        attribution: {
          sign: ({ payloadBytes }) => payloadBytes,
          now: () => new Date("2026-06-26T00:00:00.000Z"),
        },
      },
    );
    expect(res.status).toBe(200);

    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const row = getMemoriesSqliteDatabase(sync.syncPersistence)
      .query<{ event_json: string }, []>(`SELECT event_json FROM memory_provenance LIMIT 1`)
      .get();
    const event = JSON.parse(row?.event_json ?? "{}") as {
      contributor?: { format?: string; principal?: string };
    };
    expect(event.contributor?.format).toBe("khora.http-request-v1");
    expect(typeof event.contributor?.principal).toBe("string");
  });

  test("configured HTTP attribution writes contributor into delete provenance", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-http-attr-delete" };
    await stack.service.open(database);

    await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "note-del",
            namespace: "user/del",
            content: [{ key: "text", text: "to delete" }],
            labels: [],
          },
        }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
      },
    );

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/delete-memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "user/del", key: "note-del" }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
        attribution: {
          sign: ({ payloadBytes }) => payloadBytes,
          now: () => new Date("2026-06-26T00:00:00.000Z"),
        },
      },
    );
    expect(res.status).toBe(200);

    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const row = getMemoriesSqliteDatabase(sync.syncPersistence)
      .query<{ event_json: string }, []>(
        `SELECT event_json FROM memory_provenance ORDER BY rowid DESC LIMIT 1`,
      )
      .get();
    const event = JSON.parse(row?.event_json ?? "{}") as {
      kind?: string;
      contributor?: { format?: string };
    };
    expect(event.kind).toBe("DELETE_MEMORY");
    expect(event.contributor?.format).toBe("khora.http-request-v1");
  });

  test("suppress-memory advances tip with http-request contributor", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-suppress" };
    await stack.service.open(database);

    await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            key: "note-sup",
            namespace: "user/sup",
            content: [{ key: "body", text: "suppress me" }],
            labels: [],
          },
        }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
      },
    );

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/suppress-memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "user/sup", key: "note-sup" }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
        attribution: {
          sign: ({ payloadBytes }) => payloadBytes,
          now: () => new Date("2026-06-26T00:00:00.000Z"),
        },
      },
    );
    expect(res.status).toBe(200);

    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const row = getMemoriesSqliteDatabase(sync.syncPersistence)
      .query<{ event_json: string }, []>(
        `SELECT event_json FROM memory_provenance ORDER BY rowid DESC LIMIT 1`,
      )
      .get();
    const event = JSON.parse(row?.event_json ?? "{}") as {
      kind?: string;
      contributor?: { format?: string };
    };
    expect(event.kind).toBe("SUPPRESS_MEMORY");
    expect(event.contributor?.format).toBe("khora.http-request-v1");
  });

  test("client-supplied contributor is still ignored even when server attribution is enabled", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-no-spoof-with-attr" };
    await stack.service.open(database);

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "note-spoof",
            namespace: "user/spoof",
            content: [{ key: "text", text: "spoofed" }],
            labels: [],
            attribution: {
              contributor: {
                v: 1,
                format: "khora.direct-principal-v1",
                principal: "did:key:z-evil",
                payload: "eyJ2IjoxfQ",
                signature: "c2ln",
              },
            },
          },
        }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
        attribution: {
          sign: ({ payloadBytes }) => payloadBytes,
          now: () => new Date("2026-06-26T00:00:00.000Z"),
        },
      },
    );
    expect(res.status).toBe(200);

    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const row = getMemoriesSqliteDatabase(sync.syncPersistence)
      .query<{ event_json: string }, []>(`SELECT event_json FROM memory_provenance LIMIT 1`)
      .get();
    const event = JSON.parse(row?.event_json ?? "{}") as {
      contributor?: { principal?: string; format?: string };
    };
    expect(event.contributor?.principal).not.toBe("did:key:z-evil");
    expect(event.contributor?.format).toBe("khora.http-request-v1");
    expect(typeof event.contributor?.principal).toBe("string");
  });

  test("top-level intentSnapshotId round-trips into event JSON and column", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-intent-id" };
    await stack.service.open(database);

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          intentSnapshotId: "run-42",
          params: {
            kind: "node",
            key: "note-intent",
            namespace: "user/intent",
            content: [{ key: "text", text: "intent test" }],
            labels: [],
          },
        }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
      },
    );
    expect(res.status).toBe(200);

    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const row = getMemoriesSqliteDatabase(sync.syncPersistence)
      .query<{ event_json: string; intent_snapshot_id: string | null }, []>(
        `SELECT event_json, intent_snapshot_id FROM memory_provenance LIMIT 1`,
      )
      .get();
    const event = JSON.parse(row?.event_json ?? "{}") as { intent_snapshot_id?: string };
    expect(event.intent_snapshot_id).toBe("run-42");
    expect(row?.intent_snapshot_id).toBe("run-42");
  });

  test("projection input endpoint requires projection source", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-no-projection" };

    const res = await postJson(
      "http://localhost/databases/projections/projection-input",
      { database, namespace: "ns/a" },
      stack,
    );

    expect(res.status).toBe(501);
  }, 20_000);

  test("deprecated umap-input path aliases projection-input", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-umap-alias" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sync.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "alias node" }],
      labels: [],
    });

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/projections/umap-input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "ns/a", compression: "none" }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
        projectionSource: createFakeProjectionSource,
      },
    );
    expect(res.status).toBe(200);
    const input = await decodeProjectionInput(await res.arrayBuffer(), { compression: "none" });
    expect(input.embeddings[0]?.memoryKey).toBe("n1");
  }, 20_000);

  test("projection input endpoint returns compressed projection input", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-projection" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sync.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "projection node" }],
      labels: [],
    });

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/projections/projection-input", {
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
    expect(res.headers.get(PROJECTION_INPUT_ENCODING_HEADER)).toBe("gzip");
    const input = await decodeProjectionInput(await res.arrayBuffer(), { compression: "gzip" });
    expect(input.namespace).toBe("ns/a");
    expect(input.embeddings[0]?.memoryKey).toBe("n1");
    expect(input.provenanceHeadRootHex).toBeDefined();
  });

  test("projection input includeSuppressed round-trip", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-include-suppressed" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);
    client.mergeMemory({
      kind: "node",
      key: "peer",
      namespace: "ns/sup",
      content: [{ key: "text", text: "peer" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "hub",
      namespace: "ns/sup",
      content: [{ key: "text", text: "hub" }],
      labels: [],
    });
    client.suppressMemory({ namespace: "ns/sup", key: "hub" });

    const httpOpts = {
      service: stack.service,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
      projectionSource: createFakeProjectionSource,
    };

    const excludedRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/projections/projection-input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "ns/sup", compression: "none" }),
      }),
      httpOpts,
    );
    expect(excludedRes.status).toBe(200);
    const excluded = await decodeProjectionInput(await excludedRes.arrayBuffer(), {
      compression: "none",
    });
    expect(excluded.includeSuppressed).toBeUndefined();
    expect(excluded.suppressedKeys).toBeUndefined();
    expect(excluded.embeddings.some((e) => e.memoryKey === "hub")).toBe(false);

    const includedRes = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/projections/projection-input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          namespace: "ns/sup",
          compression: "none",
          includeSuppressed: true,
        }),
      }),
      httpOpts,
    );
    expect(includedRes.status).toBe(200);
    const included = await decodeProjectionInput(await includedRes.arrayBuffer(), {
      compression: "none",
    });
    expect(included.includeSuppressed).toBe(true);
    expect(included.suppressedKeys).toEqual(["hub"]);
    expect(included.embeddings.some((e) => e.memoryKey === "hub" && e.suppressed === true)).toBe(
      true,
    );
  }, 20_000);
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

      const { hits } = await client.search({
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

  test("HTTP merge accepts labeled nodes (permissive schema implements jsonSchema)", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "remote-labeled" };
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

      const memoryIds = await client.mergeMemory({
        kind: "node",
        key: "labeled-note",
        namespace: "user/labeled",
        content: [{ key: "text", text: "person memory" }],
        labels: [{ kind: "person", props: { name: "Ada" } }],
      });
      expect(memoryIds.length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });

  test("HTTP merge validates props against linked ontology and rejects invalid", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "linked-validate" };
    const linked = {
      $schema: "https://json-schema.org/draft/2020-12/schema" as const,
      type: "object" as const,
      properties: {
        nodeLabels: {
          type: "object" as const,
          additionalProperties: false as const,
          properties: {
            person: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
              additionalProperties: false,
            },
          },
        },
        edgeLabels: {
          type: "object" as const,
          additionalProperties: false as const,
          properties: {},
        },
      },
      required: ["nodeLabels", "edgeLabels"] as ["nodeLabels", "edgeLabels"],
      additionalProperties: false as const,
    };
    const { hash } = await stack.ontology.registerOntology(linked);
    await stack.service.open(database);
    await stack.ontology.linkDatabase(database, hash);

    const httpOpts = {
      service: stack.service,
      ontology: stack.ontology,
      auth: createNoneAuthStrategy(),
    };

    const invalid = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "bad-person",
            namespace: "user/linked",
            content: [{ key: "text", text: "missing name" }],
            labels: [{ kind: "person", props: {} }],
          },
        }),
      }),
      httpOpts,
    );
    expect(invalid.status).toBe(400);

    const valid = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          database,
          params: {
            kind: "node",
            key: "good-person",
            namespace: "user/linked",
            content: [{ key: "text", text: "has name" }],
            labels: [{ kind: "person", props: { name: "Ada" } }],
          },
        }),
      }),
      httpOpts,
    );
    expect(valid.status).toBe(200);
  });

  test("read client fetches and decodes projection input", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "remote-projection" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sync.syncPersistence, testOntology).mergeMemory({
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
      const input = await reads.fetchProjectionInput({ namespace: "ns/a" });
      expect(input.embeddings[0]?.memoryKey).toBe("n1");
    } finally {
      server.stop(true);
    }
  });
});
