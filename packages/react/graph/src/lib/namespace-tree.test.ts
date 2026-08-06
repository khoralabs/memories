import { describe, expect, test } from "bun:test";

import { buildSearchNamespaceTree } from "./namespace-tree.ts";

describe("buildSearchNamespaceTree", () => {
  test("returns empty for no hits", () => {
    expect(buildSearchNamespaceTree([])).toEqual([]);
  });

  test("includes ancestors and orders siblings by best score", () => {
    const tree = buildSearchNamespaceTree([
      { namespace: "a/low", score: 1 },
      { namespace: "a/high", score: 10 },
      { namespace: "b/mid", score: 5 },
    ]);

    expect(tree.map((n) => n.path)).toEqual(["a", "b"]);
    expect(tree[0]?.children.map((n) => n.path)).toEqual(["a/high", "a/low"]);
    expect(tree[1]?.children.map((n) => n.path)).toEqual(["b/mid"]);
  });

  test("keeps highest score when duplicate paths", () => {
    const tree = buildSearchNamespaceTree([
      { namespace: "x/y", score: 2 },
      { namespace: "x/y", score: 9 },
      { namespace: "x/z", score: 3 },
    ]);
    expect(tree[0]?.children.map((n) => n.path)).toEqual(["x/y", "x/z"]);
  });
});
