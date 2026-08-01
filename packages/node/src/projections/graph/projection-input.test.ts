import { describe, expect, test } from "bun:test";
import type { GraphProjectionGraphReads, GraphProjectionSource } from "../source";
import { buildNamespaceGraphLayoutFromSource } from "./build-namespace-graph-layout";
import {
  collectNamespaceProjectionInput,
  decodeProjectionInput,
  encodeProjectionInput,
  validateProjectionInput,
} from "./projection-input";
import { buildNamespaceGraphLayoutFromProjectionInput } from "./projection-input-layout";

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
  async listSuppressedNodeKeysForNamespace() {
    return [];
  },
  async isNamespaceSuppressed() {
    return false;
  },
};

describe("NamespaceProjectionInput", () => {
  test("collects exact namespace input", async () => {
    const input = await collectNamespaceProjectionInput(source, graphReads, "ns/a", {
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
    const input = await collectNamespaceProjectionInput(source, graphReads, "root", {
      scope: "subtree",
    });

    expect(input.scope).toBe("subtree");
    expect(input.edges.map((edge) => edge.fromKey)).toEqual(["root/a::m1", "root/b::m1"]);
    expect(input.embeddings.map((embedding) => embedding.memoryKey)).toEqual([
      "root/a::m1",
      "root/b::m1",
    ]);
    expect(input.labelsByKey.map(([key]) => key)).toContain("root/a::m1");
  });

  test("encodes and decodes gzip input", async () => {
    const input = await collectNamespaceProjectionInput(source, graphReads, "ns/a");
    const encoded = await encodeProjectionInput(input, { compression: "gzip" });
    const decoded = await decodeProjectionInput(encoded, { compression: "gzip" });

    expect(decoded).toEqual(input);
  });

  test("validates payloads unless dangerousSkipValidation is set", async () => {
    expect(() => validateProjectionInput({ version: 1 })).toThrow();

    const encoded = await encodeProjectionInput({ version: 1 } as never, { compression: "none" });
    await expect(decodeProjectionInput(encoded, { compression: "none" })).rejects.toThrow();
    const skipped = await decodeProjectionInput(encoded, {
      compression: "none",
      dangerousSkipValidation: true,
    });
    expect(skipped as unknown).toEqual({ version: 1 });
  });

  test("builds the same layout from collected input as source convenience API", async () => {
    const input = await collectNamespaceProjectionInput(source, graphReads, "ns/a");
    const fromInput = buildNamespaceGraphLayoutFromProjectionInput(input);
    const fromSource = await buildNamespaceGraphLayoutFromSource(source, graphReads, "ns/a");

    expect(fromInput).toEqual(fromSource);
  });
});
