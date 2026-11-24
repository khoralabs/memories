import { describe, expect, test } from "bun:test";
import { mergeMemory } from "../../../core/index";
import { renameNamespace } from "../../../core/models/rename-namespace";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "./index";

const merge = (
  p: ReturnType<typeof createMemoriesPersistence>,
  key: string,
  text: string,
  namespace = "ns",
) =>
  mergeMemory(
    { persistence: p },
    { key, namespace, content: [{ key: "alpha", text }], labels: [] },
  );

describe("state tree (sqlite)", () => {
  test("same final memories give the same state root regardless of merge order", () => {
    const a = createMemoriesPersistence(openTestMemoriesDatabase());
    const b = createMemoriesPersistence(openTestMemoriesDatabase());
    merge(a, "one", "x");
    merge(a, "two", "y");
    merge(b, "two", "y");
    merge(b, "one", "x");
    expect(a.getStateRootHex()).toBeDefined();
    expect(a.getStateRootHex()).toBe(b.getStateRootHex());
    expect(a.getProvenanceHeadRootHex()).not.toBe(b.getProvenanceHeadRootHex());
  });

  test("diff skips unchanged buckets and reports only changed leaves", () => {
    const p = createMemoriesPersistence(openTestMemoriesDatabase());
    for (let i = 0; i < 20; i++) merge(p, `k${i}`, `t${i}`);
    const before = p.getStateRootHex() as string;
    merge(p, "k3", "changed");
    const diff = p.diffStateRoots(before, p.getStateRootHex() as string);
    expect(diff.map((d) => [d.memoryKey, d.change])).toEqual([["k3", "upsert"]]);
  });

  test("namespace rename remaps state-tree entries to the new path", () => {
    const renamed = createMemoriesPersistence(openTestMemoriesDatabase());
    const direct = createMemoriesPersistence(openTestMemoriesDatabase());
    merge(renamed, "one", "x", "old/path");
    merge(direct, "one", "x", "new/path");
    renameNamespace({ persistence: renamed }, { from: "old/path", to: "new/path" });
    const root = renamed.getStateRootHex();
    expect(root).toBeDefined();
    expect(root).toBe(direct.getStateRootHex());
    expect(renamed.getMemoryContentAtStateRootHex?.(root as string, "new/path", "one")).toEqual([
      { sourceKey: "alpha", text: "x" },
    ]);
    expect(renamed.getMemoryContentAtStateRootHex?.(root as string, "old/path", "one")).toEqual([]);
  });
});
