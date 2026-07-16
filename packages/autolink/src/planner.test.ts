import { describe, expect, test } from "bun:test";
import type { Memory, SearchHit } from "@khoralabs/memories-core";
import {
  computeLexicalLinkMergeSlice,
  RETRIEVAL_SEED_NODE_KIND,
  RETRIEVAL_SIMILARITY_EDGE_KIND,
} from "./index.js";

function nodeMemory(key: string): Memory {
  return {
    namespace: "demo",
    key,
    kind: "node",
  } as Memory;
}

function edgeMemory(key: string): Memory {
  return {
    namespace: "demo",
    key,
    kind: "edge",
    edge_id: "e1",
  } as Memory;
}

function nodeHit(memory: Memory, score: number, sourceKey = "src"): SearchHit {
  return {
    _id: `sm-${memory.key}`,
    _ts_created: 0,
    memory_id: `mem-${memory.key}`,
    source_key: sourceKey,
    score,
    memory,
    labels: [],
    graph: { kind: "node" },
  } as SearchHit;
}

function edgeHit(memory: Memory, score: number): SearchHit {
  return {
    _id: `sm-${memory.key}`,
    _ts_created: 0,
    memory_id: `mem-${memory.key}`,
    source_key: "src",
    score,
    memory,
    labels: [],
    graph: {
      kind: "edge",
      edge: {
        edgeId: "e1",
        fromKey: "a",
        toKey: "b",
        labels: [],
      },
    },
  } as SearchHit;
}

const cfg = { topK: 10, searchConfig: { topK: 10, namespace: "demo" } };

describe("computeLexicalLinkMergeSlice", () => {
  test("skips self hit", () => {
    const src = "me";
    const patch = computeLexicalLinkMergeSlice(
      src,
      [nodeHit(nodeMemory(src), 99), nodeHit(nodeMemory("n1"), 0.5)],
      cfg,
    );
    expect(patch.edges?.length).toBe(1);
    expect(patch.edges?.[0]?.memory_key).toBe("n1");
  });

  test("respects topK with stable tie-break on score then key", () => {
    const hits = [
      nodeHit(nodeMemory("z"), 0.5),
      nodeHit(nodeMemory("a"), 0.5),
      nodeHit(nodeMemory("m"), 1.0),
    ];
    const patch = computeLexicalLinkMergeSlice("src", hits, {
      topK: 2,
      searchConfig: { x: 1 },
    });
    expect(patch.edges?.map((e) => e.memory_key)).toEqual(["m", "a"]);
  });

  test("dedupes same neighbor key keeping higher score", () => {
    const hits = [nodeHit(nodeMemory("n1"), 0.2), nodeHit(nodeMemory("n1"), 0.9, "other")];
    const patch = computeLexicalLinkMergeSlice("src", hits, cfg);
    expect(patch.edges?.length).toBe(1);
    expect((patch.edges?.[0]?.label.props as { similarityScore: number }).similarityScore).toBe(
      0.9,
    );
  });

  test("minSimilarityScore filters", () => {
    const hits = [nodeHit(nodeMemory("hi"), 0.1), nodeHit(nodeMemory("lo"), 0.01)];
    const patch = computeLexicalLinkMergeSlice("src", hits, {
      topK: 10,
      searchConfig: {},
      minSimilarityScore: 0.05,
    });
    expect(patch.edges?.map((e) => e.memory_key)).toEqual(["hi"]);
  });

  test("skips edge memories by default", () => {
    const hits = [nodeHit(nodeMemory("n1"), 1), edgeHit(edgeMemory("edge-m"), 2)];
    const patch = computeLexicalLinkMergeSlice("src", hits, cfg);
    expect(patch.edges?.length).toBe(1);
    expect(patch.edges?.[0]?.memory_key).toBe("n1");
  });

  test("includes edge memories when skipEdgeMemories is false", () => {
    const hits = [edgeHit(edgeMemory("edge-m"), 2)];
    const patch = computeLexicalLinkMergeSlice("src", hits, {
      ...cfg,
      skipEdgeMemories: false,
    });
    expect(patch.edges?.[0]?.memory_key).toBe("edge-m");
  });

  test("tagSourceNode adds seed label when edges exist", () => {
    const patch = computeLexicalLinkMergeSlice("src", [nodeHit(nodeMemory("n1"), 1)], {
      ...cfg,
      tagSourceNode: true,
    });
    expect(patch.labels?.length).toBe(1);
    expect(patch.labels?.[0]?.kind).toBe(RETRIEVAL_SEED_NODE_KIND);
    expect(patch.labels?.[0]?.props).toEqual({ source: "lexical_search" });
    expect(patch.edges?.[0]?.label.kind).toBe(RETRIEVAL_SIMILARITY_EDGE_KIND);
  });

  test("returns empty patch when nothing links", () => {
    expect(computeLexicalLinkMergeSlice("src", [], cfg)).toEqual({});
    expect(computeLexicalLinkMergeSlice("src", [nodeHit(nodeMemory("src"), 1)], cfg)).toEqual({});
  });
});
