import { describe, expect, test } from "bun:test";
import type { Memory, SearchHit, SearchParams } from "../core/index";
import {
  provideAutolinkSession,
  resetAutolinkSessionRegistryForTests,
  runAutolinkIntegrate,
} from "./index.js";
import { executeAutolinkIntegrate } from "./workflows/index.js";

function nodeHit(key: string, score: number): SearchHit {
  const memory = {
    namespace: "demo",
    key,
    kind: "node",
  } as Memory;
  return {
    _id: `sm-${key}`,
    _ts_created: 0,
    memory_id: `mem-${key}`,
    source_key: "src",
    score,
    memory,
    labels: [],
    graph: { kind: "node" },
  } as SearchHit;
}

function fakeClient(hits: SearchHit[]) {
  const merges: unknown[] = [];
  const searches: SearchParams[] = [];
  return {
    searches,
    merges,
    client: {
      search(params: SearchParams) {
        searches.push(params);
        return hits;
      },
      mergeMemory(params: unknown) {
        merges.push(params);
        return ["mem-focal"];
      },
    },
  };
}

describe("runAutolinkIntegrate", () => {
  test("searches, links neighbors, merges focal node", async () => {
    const { client, searches, merges } = fakeClient([nodeHit("focal", 1), nodeHit("n1", 0.8)]);

    const ids = await runAutolinkIntegrate(
      {
        namespace: "demo",
        key: "focal",
        content: [{ key: "body", text: "hello" }],
        searchContent: { text: "hello" },
        linkPlan: { topK: 5, tagSourceNode: true },
      },
      { client: client as never },
    );

    expect(ids).toEqual(["mem-focal"]);
    expect(searches).toHaveLength(1);
    expect(searches[0]?.namespace).toBe("demo");
    expect(merges).toHaveLength(1);
    const merge = merges[0] as {
      key: string;
      labels?: unknown[];
      edges?: Array<{ memory_key: string }>;
    };
    expect(merge.key).toBe("focal");
    expect(merge.edges?.map((e) => e.memory_key)).toEqual(["n1"]);
    expect(merge.labels?.length).toBe(1);
  });
});

describe("executeAutolinkIntegrate", () => {
  test("resolves client from injected deps", async () => {
    const { client, merges } = fakeClient([nodeHit("n1", 1)]);
    const ids = await executeAutolinkIntegrate(
      {
        namespace: "demo",
        key: "focal",
        content: [{ key: "body", text: "x" }],
        searchContent: { text: "x" },
      },
      { client: client as never },
    );
    expect(ids).toEqual(["mem-focal"]);
    expect(merges).toHaveLength(1);
  });

  test("resolves client from session registry", async () => {
    resetAutolinkSessionRegistryForTests();
    const { client } = fakeClient([nodeHit("n1", 1)]);
    provideAutolinkSession("sess-1", { client: client as never });
    try {
      const ids = await executeAutolinkIntegrate({
        sessionId: "sess-1",
        namespace: "demo",
        key: "focal",
        content: [{ key: "body", text: "x" }],
        searchContent: { text: "x" },
      });
      expect(ids).toEqual(["mem-focal"]);
    } finally {
      resetAutolinkSessionRegistryForTests();
    }
  });
});
