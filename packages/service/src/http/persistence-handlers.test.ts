import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ids, MemoriesClient, mergeMemory } from "@khoralabs/memories-node";
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
    const provBody = (await provRes.json()) as { rootHex: string };
    expect(typeof provBody.rootHex).toBe("string");
    expect(provBody.rootHex.length).toBeGreaterThan(0);

    const tsRes = await postJson(
      "http://localhost/databases/provenance/timestamp",
      { database, rootHex: provBody.rootHex },
      stack,
    );
    expect(tsRes.status).toBe(200);
    const tsBody = (await tsRes.json()) as { timestampMs: number | null };
    expect(typeof tsBody.timestampMs).toBe("number");

    const deleteRes = await postJson(
      "http://localhost/databases/delete-memory",
      { database, namespace: "user/a", key: "note-1" },
      stack,
    );
    expect(deleteRes.status).toBe(200);
  }, 15_000);

  test("provenance events, chain, and content-at-root", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-provenance-apis" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);

    client.mergeMemory({
      kind: "node",
      key: "mem",
      namespace: "ns/prov",
      content: [
        { key: "alpha", text: "A1" },
        { key: "beta", text: "B1" },
      ],
      labels: [],
    });
    const mergeRoot = (await postJson(
      "http://localhost/databases/provenance/head",
      { database },
      stack,
    ).then((r) => r.json())) as { rootHex: string };
    expect(mergeRoot.rootHex.length).toBe(64);

    client.replaceMemoryFeature({
      namespace: "ns/prov",
      key: "mem",
      sourceKey: "alpha",
      text: "A2",
    });
    const replaceHead = (await postJson(
      "http://localhost/databases/provenance/head",
      { database },
      stack,
    ).then((r) => r.json())) as { rootHex: string };
    expect(replaceHead.rootHex).not.toBe(mergeRoot.rootHex);

    const eventsRes = await postJson(
      "http://localhost/databases/provenance/events",
      { database, namespace: "ns/prov", key: "mem", limit: 10 },
      stack,
    );
    expect(eventsRes.status).toBe(200);
    const eventsBody = (await eventsRes.json()) as {
      events: Array<{ rootHex: string; eventType: string; id: string; createdAt: number }>;
      nextBefore?: { createdAt: number; id: string };
    };
    expect(eventsBody.events.length).toBeGreaterThanOrEqual(2);
    expect(
      eventsBody.events.every((e) => e.eventType === "MERGE_MEMORY" || e.eventType.length > 0),
    ).toBe(true);

    const eventsPage = await postJson(
      "http://localhost/databases/provenance/events",
      {
        database,
        namespace: "ns/prov",
        key: "mem",
        limit: 1,
        before: {
          createdAt: eventsBody.events[0]?.createdAt,
          id: eventsBody.events[0]?.id,
        },
      },
      stack,
    );
    expect(eventsPage.status).toBe(200);
    const eventsPageBody = (await eventsPage.json()) as {
      events: Array<{ id: string }>;
      nextBefore?: { createdAt: number; id: string };
    };
    expect(eventsPageBody.events).toHaveLength(1);
    expect(eventsPageBody.events[0]?.id).not.toBe(eventsBody.events[0]?.id);
    expect(eventsPageBody.nextBefore).toBeDefined();

    const chainRes = await postJson(
      "http://localhost/databases/provenance/chain",
      { database, limit: 1 },
      stack,
    );
    expect(chainRes.status).toBe(200);
    const chainBody = (await chainRes.json()) as {
      links: Array<{ rootHex: string }>;
      nextBeforeRootHex?: string;
    };
    expect(chainBody.links).toHaveLength(1);
    expect(chainBody.nextBeforeRootHex).toBe(chainBody.links[0]?.rootHex);

    const chainPage = await postJson(
      "http://localhost/databases/provenance/chain",
      { database, limit: 10, beforeRootHex: chainBody.nextBeforeRootHex },
      stack,
    );
    expect(chainPage.status).toBe(200);
    const chainPageBody = (await chainPage.json()) as { links: Array<{ rootHex: string }> };
    expect(chainPageBody.links.some((l) => l.rootHex === mergeRoot.rootHex)).toBe(true);

    const contentAtMerge = await postJson(
      "http://localhost/databases/provenance/content",
      {
        database,
        rootHex: mergeRoot.rootHex,
        namespace: "ns/prov",
        key: "mem",
      },
      stack,
    );
    expect(contentAtMerge.status).toBe(200);
    const mergeContent = (await contentAtMerge.json()) as {
      content: Array<{ sourceKey: string; text: string }>;
    };
    const mergeByKey = Object.fromEntries(mergeContent.content.map((c) => [c.sourceKey, c.text]));
    expect(mergeByKey).toEqual({ alpha: "A1", beta: "B1" });

    const contentAtReplace = await postJson(
      "http://localhost/databases/provenance/content",
      {
        database,
        rootHex: replaceHead.rootHex,
        namespace: "ns/prov",
        key: "mem",
      },
      stack,
    );
    expect(contentAtReplace.status).toBe(200);
    const replaceContent = (await contentAtReplace.json()) as {
      content: Array<{ sourceKey: string; text: string }>;
    };
    const replaceByKey = Object.fromEntries(
      replaceContent.content.map((c) => [c.sourceKey, c.text]),
    );
    expect(replaceByKey).toEqual({ alpha: "A2", beta: "B1" });

    client.deleteMemory({ namespace: "ns/prov", key: "mem" });
    const deleteHead = (await postJson(
      "http://localhost/databases/provenance/head",
      { database },
      stack,
    ).then((r) => r.json())) as { rootHex: string };
    const contentAtDelete = await postJson(
      "http://localhost/databases/provenance/content",
      {
        database,
        rootHex: deleteHead.rootHex,
        namespace: "ns/prov",
        key: "mem",
      },
      stack,
    );
    expect(contentAtDelete.status).toBe(200);
    const deleteContent = (await contentAtDelete.json()) as {
      content: Array<{ sourceKey: string; text: string }>;
    };
    expect(deleteContent.content).toEqual([]);

    const unknownTip = await postJson(
      "http://localhost/databases/provenance/content",
      {
        database,
        rootHex: "0".repeat(64),
        namespace: "ns/prov",
        key: "mem",
      },
      stack,
    );
    expect(unknownTip.status).toBe(200);
    expect(((await unknownTip.json()) as { content: unknown[] }).content).toEqual([]);

    const badHex = await postJson(
      "http://localhost/databases/provenance/content",
      {
        database,
        rootHex: "not-a-root-hex",
        namespace: "ns/prov",
        key: "mem",
      },
      stack,
    );
    expect(badHex.status).toBe(400);
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

  test("namespaces and search includeSuppressed + suppressed flags", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-include-suppressed-http" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);
    client.mergeMemory({
      kind: "node",
      key: "visible",
      namespace: "ns/a",
      content: [{ key: "text", text: "hello visible" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "hidden",
      namespace: "ns/a",
      content: [{ key: "text", text: "hello hidden" }],
      labels: [],
    });
    client.suppressMemory({ namespace: "ns/a", key: "hidden" });
    client.suppressNamespace({ namespace: "ns/b" });

    const excludedNs = await postJson("http://localhost/databases/namespaces", { database }, stack);
    expect(excludedNs.status).toBe(200);
    const excludedNsBody = (await excludedNs.json()) as {
      namespaces: Array<{ namespace: string; suppressed: boolean }>;
    };
    expect(excludedNsBody.namespaces.every((n) => typeof n.suppressed === "boolean")).toBe(true);
    expect(excludedNsBody.namespaces.some((n) => n.namespace === "ns/b")).toBe(false);

    const includedNs = await postJson(
      "http://localhost/databases/namespaces",
      { database, includeSuppressed: true },
      stack,
    );
    expect(includedNs.status).toBe(200);
    const includedNsBody = (await includedNs.json()) as {
      namespaces: Array<{ namespace: string; suppressed: boolean }>;
    };
    const b = includedNsBody.namespaces.find((n) => n.namespace === "ns/b");
    expect(b?.suppressed).toBe(true);

    const excludedSearch = await postJson(
      "http://localhost/databases/search",
      {
        database,
        params: {
          namespace: "ns/a",
          content: { text: "hello" },
          options: { arms: { lexical: 1, vector: 0 } },
        },
      },
      stack,
    );
    expect(excludedSearch.status).toBe(200);
    const excludedSearchBody = (await excludedSearch.json()) as {
      hits: Array<{ memory: { key: string; suppressed: boolean } }>;
    };
    expect(excludedSearchBody.hits.every((h) => typeof h.memory.suppressed === "boolean")).toBe(
      true,
    );
    expect(excludedSearchBody.hits.some((h) => h.memory.key === "hidden")).toBe(false);

    const includedSearch = await postJson(
      "http://localhost/databases/search",
      {
        database,
        params: {
          namespace: "ns/a",
          content: { text: "hello" },
          options: { arms: { lexical: 1, vector: 0 }, includeSuppressed: true },
        },
      },
      stack,
    );
    expect(includedSearch.status).toBe(200);
    const includedSearchBody = (await includedSearch.json()) as {
      hits: Array<{ memory: { key: string; suppressed: boolean } }>;
    };
    const hiddenHit = includedSearchBody.hits.find((h) => h.memory.key === "hidden");
    expect(hiddenHit?.memory.suppressed).toBe(true);

    const preview = await postJson(
      "http://localhost/databases/memory-preview",
      { database, namespace: "ns/a", key: "hidden" },
      stack,
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { suppressed: boolean; properties: unknown };
    expect(previewBody.suppressed).toBe(true);
    expect(previewBody.properties).toBeNull();
  }, 15_000);

  test("memory-preview returns freeform node properties", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-memory-preview-props" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);
    client.mergeMemory({
      kind: "node",
      key: "with_props",
      namespace: "ns/props",
      content: [{ key: "text", text: "hello" }],
      labels: [],
      properties: { title: "Note", count: 2 },
    });
    client.mergeMemory({
      kind: "node",
      key: "no_props",
      namespace: "ns/props",
      content: [{ key: "text", text: "plain" }],
      labels: [],
    });

    const withProps = await postJson(
      "http://localhost/databases/memory-preview",
      { database, namespace: "ns/props", key: "with_props" },
      stack,
    );
    expect(withProps.status).toBe(200);
    expect(await withProps.json()).toMatchObject({
      key: "with_props",
      namespace: "ns/props",
      properties: { title: "Note", count: 2 },
    });

    const without = await postJson(
      "http://localhost/databases/memory-preview",
      { database, namespace: "ns/props", key: "no_props" },
      stack,
    );
    expect(without.status).toBe(200);
    expect(await without.json()).toMatchObject({ properties: null });
  }, 15_000);

  test("namespaces under-prefix list + exists", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-ns-under-prefix" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);
    const parent = "under/root";
    const child = "under/root/child";
    const outsider = "under/other";

    client.mergeMemory({
      kind: "node",
      key: "p",
      namespace: parent,
      content: [{ key: "text", text: "parent" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "c",
      namespace: child,
      content: [{ key: "text", text: "child" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "o",
      namespace: outsider,
      content: [{ key: "text", text: "other" }],
      labels: [],
    });

    const listed = await postJson(
      "http://localhost/databases/namespaces/under-prefix",
      { database, prefix: parent },
      stack,
    );
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      namespaces: Array<{ namespace: string; suppressed: boolean }>;
    };
    expect(listedBody.namespaces.map((n) => n.namespace).sort()).toEqual([parent, child]);
    expect(listedBody.namespaces.every((n) => typeof n.suppressed === "boolean")).toBe(true);

    const exists = await postJson(
      "http://localhost/databases/namespaces/exists-under-prefix",
      { database, prefix: parent },
      stack,
    );
    expect(exists.status).toBe(200);
    expect(await exists.json()).toMatchObject({ exists: true });

    const missing = await postJson(
      "http://localhost/databases/namespaces/exists-under-prefix",
      { database, prefix: "under/missing" },
      stack,
    );
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ exists: false });

    client.suppressNamespace({ namespace: parent });
    const hidden = await postJson(
      "http://localhost/databases/namespaces/exists-under-prefix",
      { database, prefix: parent },
      stack,
    );
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toMatchObject({ exists: false });

    const included = await postJson(
      "http://localhost/databases/namespaces/exists-under-prefix",
      { database, prefix: parent, includeSuppressed: true },
      stack,
    );
    expect(included.status).toBe(200);
    expect(await included.json()).toMatchObject({ exists: true });

    const includedList = await postJson(
      "http://localhost/databases/namespaces/under-prefix",
      { database, prefix: parent, includeSuppressed: true },
      stack,
    );
    expect(includedList.status).toBe(200);
    const includedListBody = (await includedList.json()) as {
      namespaces: Array<{ namespace: string }>;
    };
    expect(includedListBody.namespaces.map((n) => n.namespace)).toContain(child);
  }, 15_000);

  test("effective-suppression: namespace ancestor/self and memory cases", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-effective-suppression" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);
    const parent = "eff/parent";
    const child = "eff/parent/child";

    client.mergeMemory({
      kind: "node",
      key: "under_parent",
      namespace: child,
      content: [{ key: "text", text: "child mem" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "exact_only",
      namespace: "eff/other",
      content: [{ key: "text", text: "other mem" }],
      labels: [],
    });
    client.suppressNamespace({ namespace: parent });
    client.suppressMemory({ namespace: "eff/other", key: "exact_only" });

    const childNs = await postJson(
      "http://localhost/databases/effective-suppression",
      { database, namespace: child },
      stack,
    );
    expect(childNs.status).toBe(200);
    expect(await childNs.json()).toMatchObject({
      namespace: child,
      effectivelySuppressed: true,
      suppressedBy: parent,
      exactSuppressed: false,
    });

    const selfNs = await postJson(
      "http://localhost/databases/effective-suppression",
      { database, namespace: parent },
      stack,
    );
    expect(selfNs.status).toBe(200);
    expect(await selfNs.json()).toMatchObject({
      namespace: parent,
      effectivelySuppressed: true,
      suppressedBy: parent,
      exactSuppressed: true,
    });

    const memUnderNs = await postJson(
      "http://localhost/databases/effective-suppression",
      { database, namespace: child, key: "under_parent" },
      stack,
    );
    expect(memUnderNs.status).toBe(200);
    expect(await memUnderNs.json()).toMatchObject({
      namespace: child,
      key: "under_parent",
      effectivelySuppressed: true,
      suppressedBy: parent,
      exactSuppressed: false,
    });

    const memExact = await postJson(
      "http://localhost/databases/effective-suppression",
      { database, namespace: "eff/other", key: "exact_only" },
      stack,
    );
    expect(memExact.status).toBe(200);
    expect(await memExact.json()).toMatchObject({
      namespace: "eff/other",
      key: "exact_only",
      effectivelySuppressed: true,
      suppressedBy: null,
      exactSuppressed: true,
    });

    const missing = await postJson(
      "http://localhost/databases/effective-suppression",
      { database, namespace: child, key: "nope" },
      stack,
    );
    expect(missing.status).toBe(404);
  }, 15_000);

  test("search-namespaces arms: omit / partial / vector>0", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-search-ns-arms" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sync.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "graph node" }],
      labels: [],
    });

    const partialArmsRes = await postJson(
      "http://localhost/databases/search-namespaces",
      { database, query: "graph", arms: { nodes: 1, lexical: 1 } },
      stack,
    );
    expect(partialArmsRes.status).toBe(200);

    const omittedArmsRes = await postJson(
      "http://localhost/databases/search-namespaces",
      { database, query: "graph" },
      stack,
    );
    expect(omittedArmsRes.status).toBe(200);

    const vectorArmRes = await postJson(
      "http://localhost/databases/search-namespaces",
      { database, query: "graph", arms: { vector: 1 } },
      stack,
    );
    expect(vectorArmRes.status).toBe(400);
    const vectorArmBody = (await vectorArmRes.json()) as { error?: string };
    expect(vectorArmBody.error).toContain("vector arm");

    const validVec = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
    const withVectorRes = await postJson(
      "http://localhost/databases/search-namespaces",
      {
        database,
        query: "graph",
        arms: { nodes: 1, lexical: 1, vector: 1 },
        vector: validVec,
      },
      stack,
    );
    expect(withVectorRes.status).toBe(200);

    const emptyVecRes = await postJson(
      "http://localhost/databases/search-namespaces",
      { database, query: "graph", vector: [] },
      stack,
    );
    expect(emptyVecRes.status).toBe(400);

    const oversizedRes = await postJson(
      "http://localhost/databases/search-namespaces",
      { database, query: "graph", vector: Array.from({ length: 4000 }, () => 0) },
      stack,
    );
    expect(oversizedRes.status).toBe(400);
  }, 15_000);

  test("search and merge reject invalid vector payloads", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-vector-validate" };
    await stack.service.open(database);

    const badSearch = await postJson(
      "http://localhost/databases/search",
      {
        database,
        params: {
          namespace: "_global_",
          content: { text: "x", vector: [1] },
        },
      },
      stack,
    );
    expect(badSearch.status).toBe(400);
    const badSearchBody = (await badSearch.json()) as { error?: string };
    expect(badSearchBody.error).toContain("params.content.vector");

    const goodVec = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
    const goodSearch = await postJson(
      "http://localhost/databases/search",
      {
        database,
        params: {
          namespace: "_global_",
          content: { text: "x", vector: goodVec },
        },
      },
      stack,
    );
    expect(goodSearch.status).toBe(200);

    const badMerge = await postJson(
      "http://localhost/databases/merge",
      {
        database,
        params: {
          kind: "node",
          key: "bad-vec",
          namespace: "user/a",
          content: [{ key: "text", text: "hi", vector: Array.from({ length: 4000 }, () => 0) }],
          labels: [],
        },
      },
      stack,
    );
    expect(badMerge.status).toBe(400);
    const badMergeBody = (await badMerge.json()) as { error?: string };
    expect(badMergeBody.error).toContain("params.content[0].vector");
  }, 15_000);

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

  test("graph-layout endpoint requires projection source", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-no-graph-layout" };

    const res = await postJson(
      "http://localhost/databases/graph-layout",
      { database, namespace: "ns/a" },
      stack,
    );

    expect(res.status).toBe(501);
  }, 20_000);

  test("graph-layout endpoint returns layout JSON", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-graph-layout" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sync.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "layout node" }],
      labels: [],
    });

    const res = await handleMemoriesServiceHttpRequest(
      new Request("http://localhost/databases/graph-layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ database, namespace: "ns/a" }),
      }),
      {
        service: stack.service,
        ontology: stack.ontology,
        auth: createNoneAuthStrategy(),
        projectionSource: createFakeProjectionSource,
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      layout: { namespace: string; nodes: Array<{ key: string }>; edges: unknown[] };
      database: { kind: string; ownerKey: string };
    };
    expect(body.database).toEqual(database);
    expect(body.layout.namespace).toBe("ns/a");
    expect(body.layout.nodes.some((n) => n.key === "n1")).toBe(true);
    expect(Array.isArray(body.layout.edges)).toBe(true);
  }, 20_000);

  test("graph-counts and graph-stats exact, suppressed, and subtree", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-graph-counts" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);
    const parent = "graph/counts";
    const child = "graph/counts/child";

    client.mergeMemory({
      kind: "node",
      key: "a",
      namespace: parent,
      content: [{ key: "text", text: "a" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "b",
      namespace: parent,
      content: [{ key: "text", text: "b" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "hidden",
      namespace: parent,
      content: [{ key: "text", text: "hidden" }],
      labels: [],
    });
    client.suppressMemory({ namespace: parent, key: "hidden" });

    mergeMemory(
      { persistence: sync.syncPersistence },
      {
        kind: "edge",
        key: "e_ab",
        namespace: parent,
        content: [{ key: "text", text: "edge ab" }],
        edge: {
          from_memory_id: ids.memory(parent, "a"),
          to_memory_id: ids.memory(parent, "b"),
          label: { kind: "references", props: {} },
        },
      },
    );

    client.mergeMemory({
      kind: "node",
      key: "c",
      namespace: child,
      content: [{ key: "text", text: "c" }],
      labels: [],
    });

    const exact = await postJson(
      "http://localhost/databases/graph-counts",
      { database, namespace: parent },
      stack,
    );
    expect(exact.status).toBe(200);
    const exactBody = (await exact.json()) as {
      nodeCount: number;
      edgeCount: number;
      scope: string;
      namespace: string;
    };
    expect(exactBody).toMatchObject({
      namespace: parent,
      scope: "exact",
      nodeCount: 2,
      edgeCount: 1,
    });

    const exactInc = await postJson(
      "http://localhost/databases/graph-counts",
      { database, namespace: parent, includeSuppressed: true },
      stack,
    );
    expect(exactInc.status).toBe(200);
    expect(await exactInc.json()).toMatchObject({
      nodeCount: 3,
      edgeCount: 1,
    });

    const empty = await postJson(
      "http://localhost/databases/graph-counts",
      { database, namespace: "graph/counts/missing" },
      stack,
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ nodeCount: 0, edgeCount: 0 });

    const subtree = await postJson(
      "http://localhost/databases/graph-counts",
      { database, namespace: parent, scope: "subtree" },
      stack,
    );
    expect(subtree.status).toBe(200);
    expect(await subtree.json()).toMatchObject({
      scope: "subtree",
      nodeCount: 3,
      edgeCount: 1,
    });

    const stats = await postJson(
      "http://localhost/databases/graph-stats",
      { database, namespace: parent },
      stack,
    );
    expect(stats.status).toBe(200);
    const statsBody = (await stats.json()) as {
      nodeCount: number;
      edgeCount: number;
      suppressedNodeCount: number;
      suppressedEdgeCount: number;
      labelKinds: { nodes: Record<string, number>; edges: Record<string, number> };
    };
    expect(statsBody.nodeCount).toBe(2);
    expect(statsBody.edgeCount).toBe(1);
    expect(statsBody.suppressedNodeCount).toBe(1);
    expect(statsBody.suppressedEdgeCount).toBe(0);
    expect(statsBody.labelKinds.edges.references).toBe(1);
  }, 20_000);

  test("graph-counts subtree does not treat underscore as LIKE wildcard", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "owner-graph-counts-us" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    const client = new MemoriesClient(sync.syncPersistence, testOntology);

    client.mergeMemory({
      kind: "node",
      key: "a",
      namespace: "user_a",
      content: [{ key: "text", text: "a" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "child",
      namespace: "user_a/child",
      content: [{ key: "text", text: "child" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "x",
      namespace: "userxa",
      content: [{ key: "text", text: "x" }],
      labels: [],
    });
    client.mergeMemory({
      kind: "node",
      key: "xchild",
      namespace: "userxa/child",
      content: [{ key: "text", text: "xchild" }],
      labels: [],
    });

    const subtree = await postJson(
      "http://localhost/databases/graph-counts",
      { database, namespace: "user_a", scope: "subtree" },
      stack,
    );
    expect(subtree.status).toBe(200);
    expect(await subtree.json()).toMatchObject({
      namespace: "user_a",
      scope: "subtree",
      nodeCount: 2,
      edgeCount: 0,
    });
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

      const headFn = client.persistence.getProvenanceHeadRootHex;
      const tsFn = client.persistence.getProvenanceTimestampMsForRootHex;
      expect(headFn).toBeDefined();
      expect(tsFn).toBeDefined();
      const rootHex = await headFn?.call(client.persistence);
      expect(typeof rootHex).toBe("string");
      expect((rootHex ?? "").length).toBeGreaterThan(0);
      if (rootHex === undefined || rootHex.length === 0) {
        throw new Error("expected provenance head rootHex");
      }
      const timestampMs = await tsFn?.call(client.persistence, rootHex);
      expect(typeof timestampMs).toBe("number");

      const withMeta = client.persistence.listNamespacesWithMetadata;
      expect(withMeta).toBeDefined();
      const catalog = await withMeta?.call(client.persistence);
      expect(catalog?.some((n) => n.namespace === "user/remote")).toBe(true);

      await client.deleteMemory({ namespace: "user/remote", key: "remote-note" });
    } finally {
      server.stop(true);
    }
  }, 15_000);

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
      });
      const input = await reads.fetchProjectionInput({ namespace: "ns/a" });
      expect(input.embeddings[0]?.memoryKey).toBe("n1");
    } finally {
      server.stop(true);
    }
  });

  test("read client getGraphLayout returns layout", async () => {
    const stack = createTestStack();
    const database = { kind: "account", ownerKey: "remote-graph-layout" };
    const handle = await stack.service.getHandle(database);
    const sync = handle.sync;
    if (sync === undefined) throw new Error("expected sqlite handle");
    new MemoriesClient(sync.syncPersistence, testOntology).mergeMemory({
      kind: "node",
      key: "n1",
      namespace: "ns/a",
      content: [{ key: "text", text: "remote layout" }],
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
      });
      const layout = await reads.getGraphLayout({ namespace: "ns/a" });
      expect(layout.namespace).toBe("ns/a");
      expect(layout.nodes.some((n) => n.key === "n1")).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});

describe("memories service at-tip detail http handlers", () => {
  test("memory-detail defaults rootHex to head and composes preview, atTip, events", async () => {
    const stack = createTestStack();
    const { service } = stack;
    const database = { kind: "account", ownerKey: "owner-detail" };
    await service.open(database);

    await postJson(
      "http://localhost/databases/merge",
      {
        database,
        params: {
          kind: "node",
          key: "n1",
          namespace: "ns/detail",
          content: [{ key: "body", text: "hello detail" }],
          labels: [],
        },
      },
      stack,
    );

    const capsRes = await postJson("http://localhost/databases/capabilities", { database }, stack);
    const capsBody = (await capsRes.json()) as { capabilities: { tipReplayAtRootHex?: boolean } };
    expect(capsBody.capabilities.tipReplayAtRootHex).toBe(true);

    const detailRes = await postJson(
      "http://localhost/databases/memory-detail",
      { database, namespace: "ns/detail", key: "n1" },
      stack,
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      rootHex?: string;
      preview: { key: string; content: unknown[] };
      atTip: { content: { content: Array<{ sourceKey: string; text: string }> } | null };
      events: { events: unknown[] };
    };
    expect(detail.preview.key).toBe("n1");
    expect(detail.rootHex).toBeDefined();
    expect(detail.atTip.content?.content.some((c) => c.text === "hello detail")).toBe(true);
    expect(detail.events.events.length).toBeGreaterThan(0);
  });

  test("provenance graph and vectors return snapshots on sqlite", async () => {
    const stack = createTestStack();
    const { service } = stack;
    const database = { kind: "account", ownerKey: "owner-graph-tip" };
    await service.open(database);

    await postJson(
      "http://localhost/databases/merge",
      {
        database,
        params: {
          kind: "node",
          key: "g1",
          namespace: "ns/graph",
          content: [{ key: "body", text: "graph tip" }],
          labels: [],
        },
      },
      stack,
    );
    const head = (await postJson(
      "http://localhost/databases/provenance/head",
      { database },
      stack,
    ).then((r) => r.json())) as { rootHex: string };

    const graphRes = await postJson(
      "http://localhost/databases/provenance/graph",
      { database, rootHex: head.rootHex, namespace: "ns/graph", key: "g1" },
      stack,
    );
    expect(graphRes.status).toBe(200);
    const graphBody = (await graphRes.json()) as { graph: { v: number; memoryKey: string } | null };
    expect(graphBody.graph?.memoryKey).toBe("g1");

    const vectorsRes = await postJson(
      "http://localhost/databases/provenance/vectors",
      { database, rootHex: head.rootHex, namespace: "ns/graph", key: "g1" },
      stack,
    );
    expect(vectorsRes.status).toBe(200);
  });

  test("memory-preview includeAtTip requires explicit rootHex", async () => {
    const stack = createTestStack();
    const { service } = stack;
    const database = { kind: "account", ownerKey: "owner-preview-at-tip" };
    await service.open(database);

    await postJson(
      "http://localhost/databases/merge",
      {
        database,
        params: {
          kind: "node",
          key: "p1",
          namespace: "ns/preview",
          content: [{ key: "body", text: "preview at tip" }],
          labels: [],
        },
      },
      stack,
    );
    const head = (await postJson(
      "http://localhost/databases/provenance/head",
      { database },
      stack,
    ).then((r) => r.json())) as { rootHex: string };

    const without = await postJson(
      "http://localhost/databases/memory-preview",
      { database, namespace: "ns/preview", key: "p1", includeAtTip: true },
      stack,
    );
    expect(without.status).toBe(200);
    expect(((await without.json()) as { atTip?: unknown }).atTip).toBeUndefined();

    const withTip = await postJson(
      "http://localhost/databases/memory-preview",
      {
        database,
        namespace: "ns/preview",
        key: "p1",
        includeAtTip: true,
        rootHex: head.rootHex,
      },
      stack,
    );
    expect(withTip.status).toBe(200);
    const body = (await withTip.json()) as {
      atTip?: { content?: { content: Array<{ text: string }> } };
    };
    expect(body.atTip?.content?.content.some((c) => c.text === "preview at tip")).toBe(true);
  });
});
