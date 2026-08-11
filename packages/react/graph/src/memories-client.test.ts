import { describe, expect, mock, test } from "bun:test";
import type {
  DatabaseSearchResponse,
  MemoriesDatabaseId,
  MemoriesServiceClient,
  RemoteMemoriesReadClient,
} from "@khoralabs/memories-service/client";

import { createServiceReactMemoriesClient } from "./service.ts";

const database: MemoriesDatabaseId = { kind: "account", ownerKey: "test-owner" };

function createMockReads(
  overrides: Partial<{
    listNamespaces: RemoteMemoriesReadClient["listNamespaces"];
    getGraphLayout: RemoteMemoriesReadClient["getGraphLayout"];
    getGraphCounts: RemoteMemoriesReadClient["getGraphCounts"];
    getGraphStats: RemoteMemoriesReadClient["getGraphStats"];
    getEdgePreview: RemoteMemoriesReadClient["getEdgePreview"];
    getMemoryPreview: RemoteMemoriesReadClient["getMemoryPreview"];
    upsertNamespaceMetadata: RemoteMemoriesReadClient["upsertNamespaceMetadata"];
    getNamespaceMetadata: RemoteMemoriesReadClient["getNamespaceMetadata"];
    renameNamespace: RemoteMemoriesReadClient["renameNamespace"];
    deleteNamespace: RemoteMemoriesReadClient["deleteNamespace"];
    getSourceMapTextPreview: RemoteMemoriesReadClient["getSourceMapTextPreview"];
  }> = {},
): RemoteMemoriesReadClient {
  return {
    listNamespaces:
      overrides.listNamespaces ??
      (async () => [{ namespace: "global", alias: null, description: "", suppressed: false }]),
    getGraphLayout:
      overrides.getGraphLayout ??
      (async () => ({
        namespace: "ns",
        nodes: [
          {
            key: "k",
            x: 0,
            y: 0,
            z: 0,
            labels: [],
            degree: { count: 0, centrality: 0 },
            suppressed: false,
          },
        ],
        edges: [],
      })),
    getGraphCounts:
      overrides.getGraphCounts ??
      (async (input) => ({
        namespace: input.namespace,
        scope: input.scope ?? "exact",
        nodeCount: 0,
        edgeCount: 0,
      })),
    getGraphStats:
      overrides.getGraphStats ??
      (async (input) => ({
        namespace: input.namespace,
        scope: input.scope ?? "exact",
        nodeCount: 0,
        edgeCount: 0,
        suppressedNodeCount: 0,
        suppressedEdgeCount: 0,
        labelKinds: { nodes: {}, edges: {} },
      })),
    getEdgePreview:
      overrides.getEdgePreview ??
      (async () => ({
        edgeId: "e1",
        fromKey: "a",
        toKey: "b",
        labels: [],
        properties: null,
        suppressed: false,
      })),
    getMemoryPreview:
      overrides.getMemoryPreview ??
      (async () => ({
        key: "k",
        namespace: "ns",
        labels: [{ kind: "Person", props: {} }],
        content: [{ sourceKey: "body", text: "hello" }],
        properties: null,
        suppressed: false,
      })),
    upsertNamespaceMetadata:
      overrides.upsertNamespaceMetadata ??
      (async (input) => ({
        namespace: input.namespace,
        alias: input.alias ?? null,
        description: input.description ?? "",
        suppressed: false,
      })),
    getNamespaceMetadata:
      overrides.getNamespaceMetadata ??
      (async () => ({ namespace: "ns", alias: null, description: "", suppressed: false })),
    renameNamespace:
      overrides.renameNamespace ?? (async () => ({ namespaces: [], renamedMemories: 0 })),
    deleteNamespace:
      overrides.deleteNamespace ?? (async () => ({ namespaces: [], deletedMemories: 0 })),
    getSourceMapTextPreview: overrides.getSourceMapTextPreview ?? (async () => "snippet"),
    getSourceMapText: async () => "full-snippet",
  } as unknown as RemoteMemoriesReadClient;
}

function createMockService(
  postJson: (path: string, body: unknown) => Promise<unknown> = async () => ({ hits: [] }),
): MemoriesServiceClient {
  return {
    postJson: postJson as MemoriesServiceClient["postJson"],
  } as unknown as MemoriesServiceClient;
}

describe("createServiceReactMemoriesClient", () => {
  test("listNamespaces maps catalog rows", async () => {
    const listNamespaces = mock(async () => [
      { namespace: "global", alias: "G", description: "root", suppressed: true },
    ]);
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ listNamespaces }),
      service: createMockService(),
    });
    await expect(client.listNamespaces()).resolves.toEqual({
      namespaces: [{ namespace: "global", alias: "G", description: "root", suppressed: true }],
    });
    expect(listNamespaces).toHaveBeenCalled();
  });

  test("listNamespaces stamps optional namespaceRoot", async () => {
    const listNamespaces = mock(async () => [
      { namespace: "acme", alias: null, description: "", suppressed: false },
    ]);
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      namespaceRoot: "  acme  ",
      reads: createMockReads({ listNamespaces }),
      service: createMockService(),
    });
    await expect(client.listNamespaces()).resolves.toEqual({
      namespaces: [{ namespace: "acme", alias: null, description: "", suppressed: false }],
      namespaceRoot: "acme",
    });
  });

  test("getGraph maps layout to GraphPayload", async () => {
    const getGraphLayout = mock(async (input: { namespace: string; scope?: string }) => {
      expect(input).toEqual({ namespace: "a/b", scope: "subtree" });
      return {
        namespace: "a/b",
        nodes: [
          {
            key: "n1",
            x: 1,
            y: 2,
            z: 3,
            labels: [{ kind: "Thing", props: {} }],
            degree: { count: 1, centrality: 1 },
          },
        ],
        edges: [
          {
            edgeId: "e1",
            fromKey: "n1",
            toKey: "n2",
            labels: [],
            directed: true,
          },
        ],
      };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ getGraphLayout }),
      service: createMockService(),
    });
    await expect(client.getGraph({ namespace: "a/b", scope: "subtree" })).resolves.toEqual({
      namespace: "a/b",
      nodes: [
        {
          key: "n1",
          x: 1,
          y: 2,
          z: 3,
          labels: [{ kind: "Thing", props: {} }],
          degree: { count: 1, centrality: 1 },
          suppressed: false,
        },
      ],
      edges: [
        {
          edgeId: "e1",
          fromKey: "n1",
          toKey: "n2",
          labels: [],
          directed: true,
          suppressed: false,
        },
      ],
    });
  });

  test("getGraphCounts and getGraphStats delegate to reads", async () => {
    const getGraphCounts = mock(async (input: { namespace: string; scope?: string }) => {
      expect(input).toEqual({ namespace: "ns", scope: "subtree" });
      return { namespace: "ns", scope: "subtree" as const, nodeCount: 2, edgeCount: 1 };
    });
    const getGraphStats = mock(async (input: { namespace: string }) => {
      expect(input).toEqual({ namespace: "ns" });
      return {
        namespace: "ns",
        scope: "exact" as const,
        nodeCount: 2,
        edgeCount: 1,
        suppressedNodeCount: 0,
        suppressedEdgeCount: 0,
        labelKinds: { nodes: { person: 2 }, edges: { references: 1 } },
      };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ getGraphCounts, getGraphStats }),
      service: createMockService(),
    });
    await expect(client.getGraphCounts({ namespace: "ns", scope: "subtree" })).resolves.toEqual({
      namespace: "ns",
      scope: "subtree",
      nodeCount: 2,
      edgeCount: 1,
    });
    await expect(client.getGraphStats({ namespace: "ns" })).resolves.toEqual({
      namespace: "ns",
      scope: "exact",
      nodeCount: 2,
      edgeCount: 1,
      suppressedNodeCount: 0,
      suppressedEdgeCount: 0,
      labelKinds: { nodes: { person: 2 }, edges: { references: 1 } },
    });
  });

  test("search maps hits, qualifies subtree keys, and loads snippets", async () => {
    const getSourceMapTextPreview = mock(async (id: string) => `text:${id}`);
    const postJson = mock(async (path: string, body: unknown) => {
      expect(path).toBe("/databases/search");
      expect(body).toEqual({
        database,
        params: {
          namespace: "ns",
          content: { text: "hello" },
          searchScopeMode: "pathSubtree",
          options: {
            topK: 10,
            maxNeighbors: 5,
            neighbors: true,
            arms: { lexical: 1, vector: 1 },
            maxVectorDistance: 0.65,
          },
        },
      });
      return {
        hits: [
          {
            id: "sm1",
            memoryId: "m1",
            sourceKey: "text",
            score: 1,
            memory: { namespace: "ns/child", key: "a", kind: "node", suppressed: false },
            labels: [],
            graph: { kind: "node" },
            neighbors: [
              {
                namespace: "ns/child",
                key: "b",
                kind: "node",
                labels: [],
                suppressed: false,
                edge: {
                  from_node_id: "x",
                  to_node_id: "y",
                  label: { kind: "rel", props: {} },
                },
              },
            ],
          },
          {
            id: "sm2",
            memoryId: "m2",
            sourceKey: "text",
            score: 0.5,
            memory: { namespace: "ns/child", key: "e1", kind: "edge", suppressed: false },
            labels: [],
            graph: {
              kind: "edge",
              edge: {
                edgeId: "e1",
                fromKey: "a",
                toKey: "b",
                labels: [],
                properties: null,
              },
            },
          },
        ],
      } satisfies DatabaseSearchResponse;
    });

    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ getSourceMapTextPreview }),
      service: createMockService(postJson),
    });

    const result = await client.search({
      namespace: "ns",
      query: "hello",
      maxVectorDistance: 0.65,
      scope: "subtree",
    });

    expect(result.hitCount).toBe(2);
    expect(result.hitKeys).toEqual(["ns/child::a", "ns/child::e1"]);
    expect(result.neighborKeys).toEqual(["ns/child::b"]);
    expect(result.keys).toEqual(["ns/child::a", "ns/child::e1", "ns/child::b"]);
    expect(result.hitSnippets).toEqual([
      { key: "ns/child::a", sourceKey: "text", text: "text:sm1" },
      { key: "ns/child::e1", sourceKey: "text", text: "text:sm2" },
    ]);
    expect(result.edgeHitSnippets).toEqual([
      {
        edgeId: "e1",
        fromKey: "ns/child::a",
        toKey: "ns/child::b",
        text: "text:sm2",
      },
    ]);
    expect(getSourceMapTextPreview).toHaveBeenCalled();
  });

  test("search returns empty for blank query without calling service", async () => {
    const postJson = mock(async () => ({ hits: [] }));
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await expect(client.search({ namespace: "ns", query: "  " })).resolves.toEqual({
      hitCount: 0,
      hitKeys: [],
      neighborKeys: [],
      keys: [],
      hitSnippets: [],
      edgeHitSnippets: [],
    });
    expect(postJson).not.toHaveBeenCalled();
  });

  test("search uses exactScope when scope is exact", async () => {
    const postJson = mock(async (_path: string, body: unknown) => {
      expect((body as { params: { searchScopeMode: string } }).params.searchScopeMode).toBe(
        "exactScope",
      );
      return { hits: [] };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await client.search({ namespace: "ns", query: "q", scope: "exact" });
    expect(postJson).toHaveBeenCalled();
  });

  test("getEdgePreview delegates to reads", async () => {
    const getEdgePreview = mock(async (namespace: string, edgeId: string) => {
      expect(namespace).toBe("n/s");
      expect(edgeId).toBe("e/1");
      return {
        edgeId: "e/1",
        fromKey: "a",
        toKey: "b",
        labels: [],
        properties: null,
        suppressed: false,
      };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ getEdgePreview }),
      service: createMockService(),
    });
    await expect(client.getEdgePreview({ namespace: "n/s", edgeId: "e/1" })).resolves.toEqual({
      edgeId: "e/1",
      fromKey: "a",
      toKey: "b",
      labels: [],
      properties: null,
      suppressed: false,
    });
  });

  test("upsertNamespace maps metadata row", async () => {
    const upsertNamespaceMetadata = mock(
      async (input: { namespace: string; alias?: string | null; description?: string }) => {
        expect(input).toEqual({
          namespace: "global/new",
          alias: "New",
          description: "d",
        });
        return {
          namespace: "global/new",
          alias: "New",
          description: "d",
          suppressed: true,
        };
      },
    );
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ upsertNamespaceMetadata }),
      service: createMockService(),
    });
    await expect(
      client.upsertNamespace({
        namespace: "global/new",
        alias: "New",
        description: "d",
      }),
    ).resolves.toEqual({
      namespace: "global/new",
      alias: "New",
      description: "d",
      suppressed: true,
    });
  });

  test("getNamespaceMetadata maps null and rows", async () => {
    const getNamespaceMetadata = mock(async (namespace: string) => {
      if (namespace === "missing") return null;
      return { namespace, alias: "A", description: "d", suppressed: true };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ getNamespaceMetadata }),
      service: createMockService(),
    });
    await expect(client.getNamespaceMetadata({ namespace: "missing" })).resolves.toBeNull();
    await expect(client.getNamespaceMetadata({ namespace: "ns" })).resolves.toEqual({
      namespace: "ns",
      alias: "A",
      description: "d",
      suppressed: true,
    });
  });

  test("renameNamespace and deleteNamespace delegate to reads", async () => {
    const renameNamespace = mock(async () => ({
      namespaces: [{ from: "a", to: "b" }],
      renamedMemories: 2,
    }));
    const deleteNamespace = mock(async () => ({
      namespaces: ["a"],
      deletedMemories: 3,
    }));
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ renameNamespace, deleteNamespace }),
      service: createMockService(),
    });
    await expect(client.renameNamespace({ from: "a", to: "b", recursive: true })).resolves.toEqual({
      namespaces: [{ from: "a", to: "b" }],
      renamedMemories: 2,
    });
    expect(renameNamespace).toHaveBeenCalledWith({ from: "a", to: "b", recursive: true });
    await expect(client.deleteNamespace({ namespace: "a", recursive: true })).resolves.toEqual({
      namespaces: ["a"],
      deletedMemories: 3,
    });
    expect(deleteNamespace).toHaveBeenCalledWith({ namespace: "a", recursive: true });
  });

  test("suppressNamespace and unsuppressNamespace post service routes", async () => {
    const postJson = mock(async (path: string, body: unknown) => {
      if (path === "/databases/suppress-namespace") {
        expect(body).toEqual({ database, namespace: "ns", intentSnapshotId: "snap" });
        return { ok: true };
      }
      if (path === "/databases/unsuppress-namespace") {
        expect(body).toEqual({ database, namespace: "ns" });
        return { ok: true };
      }
      throw new Error(`unexpected path ${path}`);
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await expect(
      client.suppressNamespace({ namespace: "ns", intentSnapshotId: "snap" }),
    ).resolves.toBeUndefined();
    await expect(client.unsuppressNamespace({ namespace: "ns" })).resolves.toBeUndefined();
    expect(postJson).toHaveBeenCalledTimes(2);
  });

  test("searchNamespaces posts /databases/search-namespaces", async () => {
    const postJson = mock(async (path: string, body: unknown) => {
      expect(path).toBe("/databases/search-namespaces");
      expect(body).toEqual({
        database,
        query: "inbox",
        under: "ops",
        arms: { nodes: 0, lexical: 1 },
        limit: 5,
      });
      return {
        query: "inbox",
        under: "ops",
        namespaces: [
          {
            namespace: "ops/mail",
            lineage: ["ops", "ops/mail"],
            score: 1,
            hitCount: 0,
            scoreSum: 1,
            scoreMax: 1,
            topHits: [],
            suppressed: false,
          },
        ],
      };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await expect(
      client.searchNamespaces({
        query: "inbox",
        under: "ops",
        arms: { nodes: 0, lexical: 1 },
        limit: 5,
      }),
    ).resolves.toEqual({
      query: "inbox",
      under: "ops",
      namespaces: [
        {
          namespace: "ops/mail",
          lineage: ["ops", "ops/mail"],
          score: 1,
          hitCount: 0,
          scoreSum: 1,
          scoreMax: 1,
          topHits: [],
          suppressed: false,
        },
      ],
    });
  });

  test("searchNamespaces forwards optional query vector", async () => {
    const vector = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
    const postJson = mock(async (path: string, body: unknown) => {
      expect(path).toBe("/databases/search-namespaces");
      expect(body).toEqual({
        database,
        query: "inbox",
        arms: { nodes: 1, lexical: 1, vector: 1 },
        vector,
      });
      return { query: "inbox", under: null, namespaces: [] };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await client.searchNamespaces({
      query: "inbox",
      arms: { nodes: 1, lexical: 1, vector: 1 },
      vector,
    });
    expect(postJson).toHaveBeenCalled();
  });

  test("searchNamespaces returns empty for blank query without calling service", async () => {
    const postJson = mock(async () => {
      throw new Error("should not be called");
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await expect(client.searchNamespaces({ query: "  " })).resolves.toEqual({
      query: "",
      under: null,
      namespaces: [],
    });
    expect(postJson).not.toHaveBeenCalled();
  });

  test("mergeMemory posts /databases/merge", async () => {
    const postJson = mock(async (path: string, body: unknown) => {
      expect(path).toBe("/databases/merge");
      expect(body).toEqual({
        database,
        params: { kind: "node", namespace: "ns", key: "k", content: [] },
        intentSnapshotId: "snap-1",
      });
      return { memoryIds: ["m1"] };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await expect(
      client.mergeMemory({
        params: { kind: "node", namespace: "ns", key: "k", content: [] },
        intentSnapshotId: "snap-1",
      }),
    ).resolves.toEqual({ memoryIds: ["m1"] });
  });

  test("deleteMemory posts /databases/delete-memory", async () => {
    const postJson = mock(async (path: string, body: unknown) => {
      expect(path).toBe("/databases/delete-memory");
      expect(body).toEqual({ database, namespace: "ns", key: "k" });
      return { ok: true };
    });
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads(),
      service: createMockService(postJson),
    });
    await expect(client.deleteMemory({ namespace: "ns", key: "k" })).resolves.toBeUndefined();
  });

  test("getMemoryPreview delegates to reads", async () => {
    const getMemoryPreview = mock(
      async (input: { namespace: string; key: string; maxChars?: number }) => {
        expect(input).toEqual({ namespace: "ns", key: "k", maxChars: 100 });
        return {
          key: "k",
          namespace: "ns",
          labels: [],
          content: [
            {
              sourceKey: "body",
              sourceMapId: "sm1",
              text: "hi",
              hasText: true,
              hasVector: false,
              createdAt: 1,
            },
          ],
          properties: { note: "x" },
          suppressed: false,
        };
      },
    );
    const client = createServiceReactMemoriesClient({
      baseUrl: "http://localhost",
      database,
      reads: createMockReads({ getMemoryPreview }),
      service: createMockService(),
    });
    await expect(
      client.getMemoryPreview({ namespace: "ns", key: "k", maxChars: 100 }),
    ).resolves.toEqual({
      key: "k",
      namespace: "ns",
      labels: [],
      content: [
        {
          sourceKey: "body",
          sourceMapId: "sm1",
          text: "hi",
          hasText: true,
          hasVector: false,
          createdAt: 1,
        },
      ],
      properties: { note: "x" },
      suppressed: false,
    });
  });
});
