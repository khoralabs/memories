import { describe, expect, test } from "bun:test";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "../sqlite/persistence/index";
import { mergeMemory } from "./api/merge-memory";

function vec512(): number[] {
  return Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
}

describe("MemoriesPersistence read helpers", () => {
  test("listVectorEmbeddingIndexDimensions is empty without vector indexes", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    expect(persistence.listVectorEmbeddingIndexDimensions()).toEqual([]);
    db.close();
  });

  test("listVectorEmbeddingIndexDimensions reflects indexed widths after content vectors", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const v = vec512();
    mergeMemory(
      { persistence },
      {
        key: "a",
        namespace: "ns",
        content: [{ key: "c1", text: "hello", vector: v }],
        labels: [],
        edges: [],
        searchMetaVector: v.map((x, i) => (i === 1 ? 99 : x)),
      },
    );
    expect(persistence.listVectorEmbeddingIndexDimensions()).toEqual([512]);
    db.close();
  });

  test("listTextFeatureExportRowsForMemory joins text to source maps", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "body", text: "export me" }],
        labels: [],
        edges: [],
      },
    );
    const memoryId = persistence.findMemoryIdByKey("ns", "m1");
    expect(memoryId).toBeTruthy();
    if (!memoryId) throw new Error("expected memory id");
    const rows = persistence.listTextFeatureExportRowsForMemory(memoryId);
    expect(rows.some((r) => r.text === "export me" && r.source_key === "body")).toBe(true);
    db.close();
  });

  test("listSourceMapsForMemory respects limit and rejects invalid limit", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    expect(() => persistence.listSourceMapsForMemory("x", 0)).toThrow(RangeError);
    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "body", text: "a" }],
        labels: [],
        edges: [],
      },
    );
    const memoryId = persistence.findMemoryIdByKey("ns", "m1");
    expect(memoryId).toBeTruthy();
    if (!memoryId) throw new Error("expected memory id");
    const maps = persistence.listSourceMapsForMemory(memoryId, 10);
    expect(maps.length).toBeGreaterThanOrEqual(1);
    expect(persistence.listSourceMapsForMemory(memoryId, 1).length).toBe(1);
    db.close();
  });
});
