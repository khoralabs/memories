import { describe, expect, test } from "bun:test";
import { mergeMemory } from "../../core/api/merge-memory";
import { suppressMemory } from "../../core/models/suppress-memory";
import { ids } from "../../persistence/core";
import {
  createMemoriesPersistence,
  openTestMemoriesDatabase,
} from "../../persistence/sqlite/persistence/index";
import { createSqliteGraphProjectionSource } from "../../persistence/sqlite/projections/source";
import { collectNamespaceProjectionInput } from "./projection-input";
import { buildNamespaceGraphLayoutFromProjectionInput } from "./projection-input-layout";

function unitVec(dim: number, hot: number): number[] {
  return Array.from({ length: dim }, (_, i) => (i === hot ? 1 : 0));
}

describe("projection includeSuppressed", () => {
  test("default excludes suppressed from edges, labels, and embeddings; opt-in wires flags", async () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const ctx = { persistence };
    const namespace = "proj/suppress";

    mergeMemory(ctx, {
      key: "peer",
      namespace,
      content: [{ key: "c", text: "peer", vector: unitVec(512, 1) }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "hub",
      namespace,
      content: [{ key: "c", text: "hub", vector: unitVec(512, 0) }],
      labels: [{ kind: "Note", props: {} }],
      edges: [],
    });
    mergeMemory(ctx, {
      kind: "edge",
      key: "em_hub_peer",
      namespace,
      content: [{ key: "c", text: "edge", vector: unitVec(512, 2) }],
      edge: {
        from_memory_id: ids.memory(namespace, "hub"),
        to_memory_id: ids.memory(namespace, "peer"),
        label: { kind: "rel", props: {} },
      },
    });

    suppressMemory(ctx, { namespace, key: "hub" });

    const source = createSqliteGraphProjectionSource(db);
    const excluded = await collectNamespaceProjectionInput(source, persistence, namespace);
    expect(excluded.includeSuppressed).toBeUndefined();
    expect(excluded.suppressedKeys).toBeUndefined();
    expect(excluded.embeddings.some((e) => e.memoryKey === "hub")).toBe(false);
    expect(excluded.edges.some((e) => e.fromKey === "hub" || e.toKey === "hub")).toBe(false);
    expect(excluded.labelsByKey.some(([key]) => key === "hub")).toBe(false);

    const included = await collectNamespaceProjectionInput(source, persistence, namespace, {
      includeSuppressed: true,
    });
    expect(included.includeSuppressed).toBe(true);
    expect(included.suppressedKeys).toEqual(["hub"]);
    expect(included.embeddings.some((e) => e.memoryKey === "hub" && e.suppressed === true)).toBe(
      true,
    );
    expect(
      included.edges.some(
        (e) => (e.fromKey === "hub" || e.toKey === "hub") && e.suppressed === true,
      ),
    ).toBe(true);
    expect(included.labelsByKey.some(([key]) => key === "hub")).toBe(true);

    const layoutHidden = buildNamespaceGraphLayoutFromProjectionInput(included);
    expect(layoutHidden.nodes.some((n) => n.key === "hub")).toBe(false);
    expect(layoutHidden.edges.some((e) => e.fromKey === "hub" || e.toKey === "hub")).toBe(false);

    const layoutShown = buildNamespaceGraphLayoutFromProjectionInput(included, {
      includeSuppressed: true,
      umapOptions: { nEpochs: 2, seed: 1 },
    });
    expect(layoutShown.nodes.some((n) => n.key === "hub" && n.suppressed === true)).toBe(true);
    expect(
      layoutShown.edges.some(
        (e) => (e.fromKey === "hub" || e.toKey === "hub") && e.suppressed === true,
      ),
    ).toBe(true);
  }, 20_000);
});
