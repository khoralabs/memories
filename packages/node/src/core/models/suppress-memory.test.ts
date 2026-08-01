import { describe, expect, test } from "bun:test";
import { ids } from "../../persistence/core";
import {
  createMemoriesPersistence,
  openTestMemoriesDatabase,
} from "../../persistence/sqlite/persistence/index";
import { mergeMemory } from "../api/merge-memory";
import { search } from "../api/search";
import { suppressMemory, unsuppressMemory } from "./suppress-memory";

describe("suppressMemory", () => {
  test("hides suppressed node and incident edge memory from search; load-by-key remains", () => {
    const persistence = createMemoriesPersistence(openTestMemoriesDatabase());
    const namespace = "suppress/test";
    const token = "unique_suppress_edge_token_xyz";
    const ctx = { persistence };

    mergeMemory(ctx, {
      key: "peer",
      namespace,
      content: [{ key: "text", text: "peer body" }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      key: "hub",
      namespace,
      content: [{ key: "text", text: `hub ${token}` }],
      labels: [],
      edges: [],
    });
    mergeMemory(ctx, {
      kind: "edge",
      key: "em_hub_peer",
      namespace,
      content: [{ key: "edge-text", text: `edge ${token}` }],
      edge: {
        from_memory_id: ids.memory(namespace, "hub"),
        to_memory_id: ids.memory(namespace, "peer"),
        label: { kind: "references", props: {} },
      },
    });

    const before = search(ctx, {
      namespace,
      content: { text: token },
      options: { topK: 20 },
    });
    expect(before.hits.some((h) => h.memory.key === "hub")).toBe(true);
    expect(before.hits.some((h) => h.memory.key === "em_hub_peer")).toBe(true);

    suppressMemory(ctx, { namespace, key: "hub" });
    expect(persistence.isMemorySuppressed(ids.memory(namespace, "hub"))).toBe(true);
    expect(persistence.findMemoryIdByKey(namespace, "hub")).toBeDefined();

    const after = search(ctx, {
      namespace,
      content: { text: token },
      options: { topK: 20 },
    });
    expect(after.hits.some((h) => h.memory.key === "hub")).toBe(false);
    expect(after.hits.some((h) => h.memory.key === "em_hub_peer")).toBe(false);

    const edges = persistence.loadGraphEdgesForNamespace(namespace);
    expect(edges.some((e) => e.fromKey === "hub" || e.toKey === "hub")).toBe(false);

    unsuppressMemory(ctx, { namespace, key: "hub" });
    const restored = search(ctx, {
      namespace,
      content: { text: token },
      options: { topK: 20 },
    });
    expect(restored.hits.some((h) => h.memory.key === "hub")).toBe(true);
    expect(restored.hits.some((h) => h.memory.key === "em_hub_peer")).toBe(true);
  }, 15_000);
});
