import { describe, expect, test } from "bun:test";
import type { GraphEdgeLink } from "../../persistence/core";
import { buildNamespaceGraphLayoutFromSource } from "./build-namespace-graph-layout";
import { buildNamespaceGraphLayoutFromRows, undirectedDegreeByKey } from "./layout-core";
import type { GraphLayoutEdge } from "./layout-types";

describe("undirectedDegreeByKey", () => {
  test("counts incident edges; self-loops once", () => {
    const edges: GraphLayoutEdge[] = [
      { edgeId: "e1", fromKey: "hub", toKey: "a", labels: [] },
      { edgeId: "e2", fromKey: "hub", toKey: "b", labels: [] },
      { edgeId: "e3", fromKey: "a", toKey: "a", labels: [] },
    ];
    const degrees = undirectedDegreeByKey(edges);
    expect(degrees.get("hub")).toBe(2);
    expect(degrees.get("a")).toBe(2);
    expect(degrees.get("b")).toBe(1);
  });
});

describe("buildNamespaceGraphLayoutFromRows connectivity", () => {
  test("hub has higher degree centrality than leaf; isolated is 0", () => {
    const layout = buildNamespaceGraphLayoutFromRows({
      namespace: "ns",
      edges: [
        { edgeId: "e1", fromKey: "hub", toKey: "a", labels: [] },
        { edgeId: "e2", fromKey: "hub", toKey: "b", labels: [] },
      ],
      embeddings: [
        { memoryId: "m1", memoryKey: "hub", embedding: [1, 0] },
        { memoryId: "m2", memoryKey: "a", embedding: [0, 1] },
        { memoryId: "m3", memoryKey: "b", embedding: [0, 0] },
        { memoryId: "m4", memoryKey: "lonely", embedding: [0.5, 0.5] },
      ],
      labelsByKey: new Map(),
      propertiesByKey: new Map(),
      umapOptions: { nEpochs: 2, seed: 1 },
    });

    const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
    expect(byKey.get("hub")?.degree).toEqual({ count: 2, centrality: 1 });
    expect(byKey.get("a")?.degree).toEqual({ count: 1, centrality: 0.5 });
    expect(byKey.get("lonely")?.degree).toEqual({ count: 0, centrality: 0 });
  });
});

describe("buildNamespaceGraphLayoutFromSource", () => {
  test("combines graph topology with source-backed embeddings", async () => {
    const edge: GraphEdgeLink = {
      edgeId: "e1",
      fromKey: "a",
      toKey: "b",
      labels: [{ kind: "relates_to", props: {} }],
      directed: true,
    };

    const layout = await buildNamespaceGraphLayoutFromSource(
      {
        async listNamespacesUnderPrefix() {
          return ["ns"];
        },
        async loadMeanEmbeddingsForNamespace() {
          return [
            { memoryId: "m1", memoryKey: "a", embedding: [1, 0, 0] },
            { memoryId: "m2", memoryKey: "b", embedding: [0, 1, 0] },
          ];
        },
        async loadMemoryTextPreview() {
          return null;
        },
        async loadSourceMapTextPreview() {
          return null;
        },
      },
      {
        loadGraphEdgesForNamespace() {
          return [edge];
        },
        loadNodeLabelsForNamespace() {
          return new Map([["a", [{ kind: "Topic", props: {} }]]]);
        },
        loadNodePropertiesForNamespace() {
          return new Map([["a", { color: "blue" }]]);
        },
      },
      "ns",
    );

    expect(layout.namespace).toBe("ns");
    expect(layout.nodes.map((node) => node.key)).toEqual(["a", "b"]);
    expect(layout.nodes.every((n) => n.degree.count === 1 && n.degree.centrality === 1)).toBe(true);
    expect(layout.edges).toEqual([
      {
        edgeId: "e1",
        fromKey: "a",
        toKey: "b",
        labels: [{ kind: "relates_to", props: {} }],
        directed: true,
      },
    ]);
  });
});
