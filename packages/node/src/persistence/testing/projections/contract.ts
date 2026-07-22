import { describe, expect, test } from "bun:test";
import { mergeMemoryAsync } from "../../../core/index";
import { ids, namespacePath } from "../../../persistence/core";
import type { MemoriesPersistenceAsync } from "../../../persistence/core/persistence";
import { resolveMemoriesBackendCapabilities } from "../../../persistence/core/persistence";
import {
  buildNamespaceGraphLayoutFromSource,
  type GraphProjectionSource,
} from "../../../projections/index";

export type MemoriesProjectionsContractHandles = {
  source: GraphProjectionSource;
  /** Used to seed via mergeMemoryAsync and as GraphProjectionGraphReads. */
  persistence: MemoriesPersistenceAsync;
};

export type MemoriesProjectionsContractFactory = () =>
  | MemoriesProjectionsContractHandles
  | Promise<MemoriesProjectionsContractHandles>;

function uniqueNs(prefix: string): string {
  return `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const makeVec = (fill: number): number[] => Array.from(new Float32Array(512).fill(fill));

export function runMemoriesProjectionsContractTests(
  name: string,
  create: MemoriesProjectionsContractFactory,
): void {
  describe(`${name} projections contract`, () => {
    test("listNamespacesUnderPrefix returns exact and nested namespaces", async () => {
      const { source, persistence } = await create();
      const root = uniqueNs("proj/ns");
      const nested = namespacePath(`${root}/child`);
      const sibling = uniqueNs("proj/sibling");

      await mergeMemoryAsync(
        { persistence },
        {
          namespace: root,
          key: "a",
          content: [{ key: "body", text: "root" }],
          labels: [],
          edges: [],
        },
      );
      await mergeMemoryAsync(
        { persistence },
        {
          namespace: nested,
          key: "b",
          content: [{ key: "body", text: "nested" }],
          labels: [],
          edges: [],
        },
      );
      await mergeMemoryAsync(
        { persistence },
        {
          namespace: sibling,
          key: "c",
          content: [{ key: "body", text: "sibling" }],
          labels: [],
          edges: [],
        },
      );

      const listed = await source.listNamespacesUnderPrefix(root);
      expect(listed).toContain(root);
      expect(listed).toContain(nested);
      expect(listed).not.toContain(sibling);
      expect([...listed].sort((a, b) => a.localeCompare(b))).toEqual(listed);
    });

    test("loadMeanEmbeddingsForNamespace mean-pools user vectors and excludes system maps", async () => {
      const { source, persistence } = await create();
      const caps = resolveMemoriesBackendCapabilities(persistence);
      if (!caps.vectorSearch) return;

      const namespace = uniqueNs("proj/emb");
      await mergeMemoryAsync(
        { persistence },
        {
          namespace,
          key: "note",
          content: [
            { key: "v1", vector: makeVec(1) },
            { key: "v2", vector: makeVec(3) },
          ],
          labels: [],
          edges: [],
          // Distinct from content mean so exclusion is observable.
          searchMetaVector: makeVec(100),
        },
      );
      await mergeMemoryAsync(
        { persistence },
        {
          namespace,
          key: "other",
          content: [{ key: "body", vector: makeVec(10) }],
          labels: [],
          edges: [],
        },
      );

      const embeddings = await source.loadMeanEmbeddingsForNamespace(namespace);
      const byKey = new Map(embeddings.map((e) => [e.memoryKey, e]));

      const note = byKey.get("note");
      expect(note).toBeDefined();
      expect(note?.memoryId).toBe(ids.memory(namespace, "note"));
      expect(note?.embedding[0]).toBeCloseTo(2, 5);
      expect(note?.embedding.every((x) => Math.abs(x - 2) < 1e-5)).toBe(true);

      const other = byKey.get("other");
      expect(other).toBeDefined();
      expect(other?.embedding[0]).toBeCloseTo(10, 5);
    });

    test("loadMemoryTextPreview joins ordered chunks and truncates", async () => {
      const { source, persistence } = await create();
      const namespace = uniqueNs("proj/text");
      await mergeMemoryAsync(
        { persistence },
        {
          namespace,
          key: "doc",
          content: [
            { key: "a", text: "hello" },
            { key: "b", text: "world" },
          ],
          labels: [],
          edges: [],
        },
      );

      const full = await source.loadMemoryTextPreview(namespace, "doc");
      expect(full).toContain("hello");
      expect(full).toContain("world");
      expect(full).toMatch(/\n\n/);
      // User content chunks only (exclude system `__*` maps) — both present, joined.
      expect(full).not.toBeNull();
      const userOnly = (full ?? "")
        .split("\n\n")
        .filter((chunk) => chunk === "hello" || chunk === "world");
      expect(userOnly.sort()).toEqual(["hello", "world"]);

      const truncated = await source.loadMemoryTextPreview(namespace, "doc", 6);
      expect(truncated).not.toBeNull();
      expect(truncated?.endsWith("…")).toBe(true);
      expect(truncated?.length).toBeLessThanOrEqual(6);
    });

    test("loadSourceMapTextPreview is scoped to one source map", async () => {
      const { source, persistence } = await create();
      const namespace = uniqueNs("proj/smap");
      await mergeMemoryAsync(
        { persistence },
        {
          namespace,
          key: "doc",
          content: [
            { key: "only-a", text: "alpha-only" },
            { key: "only-b", text: "beta-only" },
          ],
          labels: [],
          edges: [],
        },
      );

      const memoryId = ids.memory(namespace, "doc");
      const sourceMapId = ids.sourceMap(memoryId, "only-a");

      const preview = await source.loadSourceMapTextPreview(sourceMapId);
      expect(preview).toBe("alpha-only");
      expect(preview).not.toContain("beta-only");
    });

    test("buildNamespaceGraphLayoutFromSource returns nodes and edges", async () => {
      const { source, persistence } = await create();
      const caps = resolveMemoriesBackendCapabilities(persistence);
      if (!caps.graphIndex || !caps.vectorSearch) return;

      const namespace = uniqueNs("proj/layout");
      await mergeMemoryAsync(
        { persistence },
        {
          namespace,
          key: "a",
          content: [{ key: "body", text: "a", vector: makeVec(1) }],
          labels: [{ kind: "topic", props: {} }],
          edges: [],
        },
      );
      await mergeMemoryAsync(
        { persistence },
        {
          namespace,
          key: "b",
          content: [{ key: "body", text: "b", vector: makeVec(-1) }],
          labels: [],
          edges: [
            {
              peer_memory_id: ids.memory(namespace, "a"),
              direction: "out",
              label: { kind: "rel", props: {} },
            },
          ],
        },
      );

      const layout = await buildNamespaceGraphLayoutFromSource(source, persistence, namespace);
      expect(layout.nodes.some((n) => n.key === "a")).toBe(true);
      expect(layout.nodes.some((n) => n.key === "b")).toBe(true);
      expect(layout.edges.length).toBeGreaterThanOrEqual(1);
    });
  });
}
