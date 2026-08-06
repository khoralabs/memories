import { describe, expect, test } from "bun:test";

import { graphNamespaceSearchSummaryLine, graphSearchSummaryLine } from "./use-graph-search.ts";

describe("graphSearchSummaryLine", () => {
  test("empty query yields empty summary", () => {
    expect(graphSearchSummaryLine("", null)).toBe("");
    expect(
      graphSearchSummaryLine("", {
        hitCount: 1,
        relevantKeys: new Set(["a"]),
        hitSnippetByKey: new Map(),
        hitSnippetByEdgeId: new Map(),
      }),
    ).toBe("");
  });

  test("pending results show ellipsis", () => {
    expect(graphSearchSummaryLine("q", null)).toBe("…");
  });

  test("formats hit and subgraph counts", () => {
    expect(
      graphSearchSummaryLine("q", {
        hitCount: 1,
        relevantKeys: new Set(["a"]),
        hitSnippetByKey: new Map(),
        hitSnippetByEdgeId: new Map(),
      }),
    ).toBe("1 hit · 1 in subgraph");
    expect(
      graphSearchSummaryLine("q", {
        hitCount: 2,
        relevantKeys: new Set(["a", "b", "c"]),
        hitSnippetByKey: new Map(),
        hitSnippetByEdgeId: new Map(),
      }),
    ).toBe("2 hits · 3 in subgraph");
  });
});

describe("graphNamespaceSearchSummaryLine", () => {
  test("empty query yields empty summary", () => {
    expect(graphNamespaceSearchSummaryLine("", null)).toBe("");
    expect(graphNamespaceSearchSummaryLine("", [])).toBe("");
  });

  test("pending results show ellipsis", () => {
    expect(graphNamespaceSearchSummaryLine("q", null)).toBe("…");
  });

  test("formats namespace counts", () => {
    expect(
      graphNamespaceSearchSummaryLine("q", [
        {
          namespace: "a",
          lineage: ["a"],
          score: 1,
          hitCount: 0,
          scoreSum: 0,
          scoreMax: 0,
          topHits: [],
        },
      ]),
    ).toBe("1 namespace");
    expect(graphNamespaceSearchSummaryLine("q", [])).toBe("0 namespaces");
  });
});
