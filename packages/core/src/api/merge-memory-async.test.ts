import { describe, expect, test } from "bun:test";
import { ids } from "../models/ids";
import type { MemoriesPersistenceAsync } from "../persistence/async-types";
import { mergeMemoryAsync } from "./merge-memory-async";

const vec512 = (): number[] => Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));

describe("mergeMemoryAsync", () => {
  test("syncMemorySearchMeta receives metaVector only for primary memoryKey", async () => {
    const syncMetaCalls: { memoryKey: string; metaVector?: Float32Array }[] = [];
    const labelPropsCalls: { memoryKey: string }[] = [];
    let sm = 0;

    const persistence = {
      capabilities: {
        lexicalSearch: true,
        vectorSearch: true,
        neighborIndex: true,
        graphIndex: true,
        multiNamespaceSearch: true,
        unscopedSearch: true,
      },
      withTransaction: async <T>(fn: () => Promise<T>) => fn(),
      listNeighborMemoriesForNode: async () => [],
      loadMemoryNamespaceKey: async () => undefined,
      replaceMemoryScopes: async () => {},
      clearMemorySubtree: async () => {},
      upsertMemory: async () => ({ memoryId: "mid", _ts_created: 1 }),
      upsertNodeForMemoryKey: async () => ({ nodeId: "nid" }),
      insertSourceMap: async () => ({ sourceMapId: `sm${++sm}` }),
      insertLexicalFeature: async () => {},
      insertVectorFeature: async () => ({ vectorFeatureId: "vf" }),
      updateSourceMapContentHash: async () => {},
      appendProvenanceEvent: async () => {},
      getProvenanceHeadRootHex: async () => undefined,
      ensureNodeLabel: async () => "nl",
      insertNodeLabelAssignment: async () => {},
      syncMemorySearchMeta: async (
        _op: { now: number },
        input: { memoryKey: string; metaVector?: Float32Array },
      ) => {
        syncMetaCalls.push({
          memoryKey: input.memoryKey,
          metaVector: input.metaVector,
        });
      },
      syncLabelPropsSearchFeatures: async (
        _op: { now: number },
        input: { namespace: string; memoryKey: string },
      ) => {
        labelPropsCalls.push({ memoryKey: input.memoryKey });
      },
    } as unknown as MemoriesPersistenceAsync;

    await mergeMemoryAsync(
      { persistence },
      {
        namespace: "ns",
        key: "primary",
        labels: [],
        content: [{ key: "body", text: "hello" }],
        searchMetaVector: vec512(),
      },
    );

    expect(syncMetaCalls).toHaveLength(1);
    expect(syncMetaCalls[0]?.memoryKey).toBe("primary");
    expect(syncMetaCalls[0]?.metaVector?.length).toBe(512);
    expect(labelPropsCalls).toEqual([{ memoryKey: "primary" }]);
  });

  test("syncLabelPropsSearchFeatures invoked once per sync key (primary + edge targets)", async () => {
    const labelPropsKeys: string[] = [];

    const persistence = {
      capabilities: {
        lexicalSearch: true,
        vectorSearch: true,
        neighborIndex: true,
        graphIndex: true,
        multiNamespaceSearch: true,
        unscopedSearch: true,
      },
      withTransaction: async <T>(fn: () => Promise<T>) => fn(),
      listNeighborMemoriesForNode: async () => [],
      loadMemoryNamespaceKey: async (memoryId: string) => {
        if (memoryId === ids.memory("ns", "nb")) {
          return { namespace: "ns", key: "nb" };
        }
        return undefined;
      },
      replaceMemoryScopes: async () => {},
      clearMemorySubtree: async () => {},
      upsertMemory: async () => ({ memoryId: "mid", _ts_created: 1 }),
      upsertNodeForMemoryKey: async () => ({ nodeId: "nid" }),
      insertSourceMap: async () => ({ sourceMapId: "sm1" }),
      insertLexicalFeature: async () => {},
      insertVectorFeature: async () => ({ vectorFeatureId: "vf" }),
      updateSourceMapContentHash: async () => {},
      appendProvenanceEvent: async () => {},
      getProvenanceHeadRootHex: async () => undefined,
      ensureNodeLabel: async () => "nl",
      insertNodeLabelAssignment: async () => {},
      findMemoryIdByKey: async () => "otherMid",
      nodeExists: async () => true,
      insertEdge: async () => ({ edgeId: "e1" }),
      ensureEdgeLabel: async () => "el",
      insertEdgeLabelAssignment: async () => {},
      syncMemorySearchMeta: async () => {},
      syncLabelPropsSearchFeatures: async (
        _op: { now: number },
        input: { namespace: string; memoryKey: string },
      ) => {
        labelPropsKeys.push(input.memoryKey);
      },
    } as unknown as MemoriesPersistenceAsync;

    await mergeMemoryAsync(
      { persistence },
      {
        namespace: "ns",
        key: "primary",
        labels: [],
        content: [{ key: "body", text: "hello" }],
        edges: [
          {
            peer_memory_id: ids.memory("ns", "nb"),
            direction: "out",
            label: { kind: "relates", props: {} },
          },
        ],
      },
    );

    expect([...labelPropsKeys].sort()).toEqual(["nb", "primary"]);
  });
});
