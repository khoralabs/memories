import { describe, expect, test } from "bun:test";
import type { GraphEdgeLink } from "@khoralabs/memories-persistence-core";
import { buildNamespaceGraphLayoutFromSource } from "./build-namespace-graph-layout";

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
