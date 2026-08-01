import { describe, expect, test } from "bun:test";
import { ids } from "../../persistence/core";
import {
  createMemoriesPersistence,
  openTestMemoriesDatabase,
} from "../../persistence/sqlite/persistence/index";
import { createSqliteGraphProjectionSource } from "../../persistence/sqlite/projections/source";
import { collectNamespaceProjectionInput } from "../../projections/graph/projection-input";
import { mergeMemory } from "../api/merge-memory";
import { search } from "../api/search";
import { renameNamespace } from "./rename-namespace";
import { suppressNamespace, unsuppressNamespace } from "./suppress-namespace";

describe("suppressNamespace", () => {
  test("parent suppress hides child ns from search/graph/catalog; writes still allowed", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const ctx = { persistence };
    const parent = "ns/suppress/parent";
    const child = "ns/suppress/parent/child";
    const token = "unique_ns_suppress_token_xyz";

    mergeMemory(ctx, {
      key: "parent_mem",
      namespace: parent,
      content: [{ key: "text", text: `parent ${token}` }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "child_mem",
      namespace: child,
      content: [{ key: "text", text: `child ${token}` }],
      labels: [],
      edges: [],
    });

    const before = search(ctx, {
      namespace: parent,
      searchScopeMode: "pathSubtree",
      content: { text: token },
      options: { topK: 20 },
    });
    expect(before.hits.some((h) => h.memory.key === "parent_mem")).toBe(true);
    expect(before.hits.some((h) => h.memory.key === "child_mem")).toBe(true);

    suppressNamespace(ctx, { namespace: parent });
    expect(persistence.isNamespaceSuppressed(parent)).toBe(true);
    expect(persistence.isNamespaceSuppressed(child)).toBe(true);
    expect(persistence.getNamespaceMetadata(parent)?.suppressed).toBe(true);
    // Child has no own suppress row.
    expect(persistence.getNamespaceMetadata(child)?.suppressed).toBeUndefined();

    const after = search(ctx, {
      namespace: parent,
      searchScopeMode: "pathSubtree",
      content: { text: token },
      options: { topK: 20 },
    });
    expect(after.hits.some((h) => h.memory.key === "parent_mem")).toBe(false);
    expect(after.hits.some((h) => h.memory.key === "child_mem")).toBe(false);

    expect(persistence.loadGraphEdgesForNamespace(parent)).toEqual([]);
    expect(persistence.loadGraphEdgesForNamespace(child)).toEqual([]);
    expect(persistence.listMemoryNamespaces().some((ns) => ns === parent || ns === child)).toBe(
      false,
    );
    expect(
      persistence
        .listNamespacesWithMetadata()
        .some((n) => n.namespace === parent || n.namespace === child),
    ).toBe(false);

    // Writes into suppressed child still succeed; load-by-key remains.
    mergeMemory(ctx, {
      key: "after_suppress",
      namespace: child,
      content: [{ key: "text", text: `after ${token}` }],
      labels: [],
      edges: [],
    });
    expect(persistence.findMemoryIdByKey(child, "after_suppress")).toBe(
      ids.memory(child, "after_suppress"),
    );
    const stillHidden = search(ctx, {
      namespace: child,
      content: { text: token },
      options: { topK: 20 },
    });
    expect(stillHidden.hits.some((h) => h.memory.key === "after_suppress")).toBe(false);
  }, 15_000);

  test("projection default excludes suppressed namespaces; opt-in marks them", async () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const ctx = { persistence };
    const parent = "proj/ns/suppress";
    const child = "proj/ns/suppress/child";

    mergeMemory(ctx, {
      key: "p",
      namespace: parent,
      content: [{ key: "c", text: "p", vector: [1, 0, 0, ...Array(509).fill(0)] }],
      labels: [{ kind: "Note", props: {} }],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "c",
      namespace: child,
      content: [{ key: "c", text: "c", vector: [0, 1, 0, ...Array(509).fill(0)] }],
      labels: [{ kind: "Note", props: {} }],
      edges: [],
    });

    suppressNamespace(ctx, { namespace: parent });

    const source = createSqliteGraphProjectionSource(db);
    const excluded = await collectNamespaceProjectionInput(source, persistence, parent, {
      scope: "subtree",
    });
    expect(
      excluded.embeddings.some((e) => e.memoryKey.includes("p") || e.memoryKey.includes("c")),
    ).toBe(false);
    expect(excluded.suppressedNamespaces).toBeUndefined();

    const included = await collectNamespaceProjectionInput(source, persistence, parent, {
      scope: "subtree",
      includeSuppressed: true,
    });
    expect(included.includeSuppressed).toBe(true);
    expect(included.suppressedNamespaces).toEqual([child, parent].sort());
    expect(included.suppressedKeys?.length).toBeGreaterThan(0);
    expect(included.embeddings.every((e) => e.suppressed === true)).toBe(true);
  }, 20_000);

  test("idempotent suppress/unsuppress and provenance kinds", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const ctx = { persistence };
    const namespace = "ns/idempotent";

    mergeMemory(ctx, {
      key: "k",
      namespace,
      content: [{ key: "text", text: "x" }],
      labels: [],
      edges: [],
    });

    const head0 = persistence.getProvenanceHeadRootHex();
    suppressNamespace(ctx, { namespace });
    const head1 = persistence.getProvenanceHeadRootHex();
    expect(head1).not.toBe(head0);
    suppressNamespace(ctx, { namespace });
    expect(persistence.getProvenanceHeadRootHex()).toBe(head1);

    const kinds = db
      .query<{ event_type: string }, []>(
        `SELECT event_type FROM memory_provenance ORDER BY _ts_created`,
      )
      .all()
      .map((r) => r.event_type);
    expect(kinds.filter((k) => k === "SUPPRESS_NAMESPACE")).toHaveLength(1);

    unsuppressNamespace(ctx, { namespace });
    const head2 = persistence.getProvenanceHeadRootHex();
    expect(head2).not.toBe(head1);
    unsuppressNamespace(ctx, { namespace });
    expect(persistence.getProvenanceHeadRootHex()).toBe(head2);

    const kinds2 = db
      .query<{ event_type: string }, []>(
        `SELECT event_type FROM memory_provenance ORDER BY _ts_created`,
      )
      .all()
      .map((r) => r.event_type);
    expect(kinds2.filter((k) => k === "UNSUPPRESS_NAMESPACE")).toHaveLength(1);
  }, 15_000);

  test("rename preserves namespace suppressed flag", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const ctx = { persistence };

    mergeMemory(ctx, {
      key: "k",
      namespace: "old/ns",
      content: [{ key: "text", text: "x" }],
      labels: [],
      edges: [],
    });
    suppressNamespace(ctx, { namespace: "old/ns" });
    expect(persistence.getNamespaceMetadata("old/ns")?.suppressed).toBe(true);

    renameNamespace(ctx, { from: "old/ns", to: "new/ns" });
    expect(persistence.getNamespaceMetadata("old/ns")).toBeUndefined();
    expect(persistence.getNamespaceMetadata("new/ns")?.suppressed).toBe(true);
    expect(persistence.isNamespaceSuppressed("new/ns")).toBe(true);
  }, 15_000);
});
