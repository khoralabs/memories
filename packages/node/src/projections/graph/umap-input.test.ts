import { describe, expect, test } from "bun:test";
import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import { buildNamespaceGraphLayoutFromSource } from "./build-namespace-graph-layout";
import {
  collectNamespaceUmapInput,
  decodeUmapInput,
  encodeUmapInput,
  validateUmapInput,
} from "./umap-input";
import { buildNamespaceGraphLayoutFromUmapInput } from "./umap-input-layout";

const source: GraphProjectionSource = {
  async listNamespacesUnderPrefix(prefix) {
    return [`${prefix}/a`, `${prefix}/b`];
  },
  async loadMeanEmbeddingsForNamespace(namespace) {
    return [
      {
        memoryId: `${namespace}:m1`,
        memoryKey: "m1",
        embedding: namespace.endsWith("/b") ? [0, 1, 0] : [1, 0, 0],
      },
    ];
  },
  async loadMemoryTextPreview() {
    return null;
  },
  async loadSourceMapTextPreview() {
    return null;
  },
};

const graphReads: GraphProjectionGraphReads = {
  async loadGraphEdgesForNamespace(namespace) {
    return [
      {
        edgeId: "e1",
        fromKey: "m1",
        toKey: "m2",
        labels: [{ kind: "relates", props: {} }],
        directed: true,
        properties: null,
      },
    ].filter(() => namespace.length > 0);
  },
  async loadNodeLabelsForNamespace() {
    return new Map([
      ["m1", [{ kind: "Note", props: { color: "blue" } }]],
      ["m2", []],
    ]);
  },
  async loadNodePropertiesForNamespace() {
    return new Map([
      ["m1", { title: "One" }],
      ["m2", null],
    ]);
  },
};

describe("NamespaceUmapInput", () => {
  test("collects exact namespace input", async () => {
    const input = await collectNamespaceUmapInput(source, graphReads, "ns/a", {
      provenanceHeadRootHex: "abc123",
    });

    expect(input.version).toBe(1);
    expect(input.scope).toBe("exact");
    expect(input.namespace).toBe("ns/a");
    expect(input.edges[0]?.edgeId).toBe("e1");
    expect(input.labelsByKey[0]?.[0]).toBe("m1");
    expect(input.propertiesByKey[0]?.[1]).toEqual({ title: "One" });
    expect(input.provenanceHeadRootHex).toBe("abc123");
  });

  test("collects subtree input with qualified keys", async () => {
    const input = await collectNamespaceUmapInput(source, graphReads, "root", { scope: "subtree" });

    expect(input.scope).toBe("subtree");
    expect(input.edges.map((edge) => edge.fromKey)).toEqual(["root/a::m1", "root/b::m1"]);
    expect(input.embeddings.map((embedding) => embedding.memoryKey)).toEqual([
      "root/a::m1",
      "root/b::m1",
    ]);
    expect(input.labelsByKey.map(([key]) => key)).toContain("root/a::m1");
  });

  test("encodes and decodes gzip input", async () => {
    const input = await collectNamespaceUmapInput(source, graphReads, "ns/a");
    const encoded = await encodeUmapInput(input, { compression: "gzip" });
    const decoded = await decodeUmapInput(encoded, { compression: "gzip" });

    expect(decoded).toEqual(input);
  });

  test("validates payloads unless dangerousSkipValidation is set", async () => {
    expect(() => validateUmapInput({ version: 1 })).toThrow();

    const encoded = await encodeUmapInput({ version: 1 } as never, { compression: "none" });
    await expect(decodeUmapInput(encoded, { compression: "none" })).rejects.toThrow();
    const skipped = await decodeUmapInput(encoded, {
      compression: "none",
      dangerousSkipValidation: true,
    });
    expect(skipped as unknown).toEqual({ version: 1 });
  });

  test("builds the same layout from collected input as source convenience API", async () => {
    const input = await collectNamespaceUmapInput(source, graphReads, "ns/a");
    const fromInput = buildNamespaceGraphLayoutFromUmapInput(input);
    const fromSource = await buildNamespaceGraphLayoutFromSource(source, graphReads, "ns/a");

    expect(fromInput).toEqual(fromSource);
  });
});
