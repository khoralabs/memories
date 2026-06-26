import { describe, expect, test } from "bun:test";
import { ids } from "@khoralabs/memories-persistence-core";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "@khoralabs/memories-sqlite";
import { mergeMemory } from "./api/merge-memory";
import { search } from "./api/search";

function openTestDb() {
  return openTestMemoriesDatabase();
}

const vec512 = (i: number, v = 1): number[] =>
  Array.from({ length: 512 }, (_, j) => (j === i ? v : 0));

describe("scoped search helpers", () => {
  test("searchLexicalSourceMapIds respects memoryIds allowlist", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "a", text: "hello unique alpha" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "m2",
        namespace: "ns",
        content: [{ key: "b", text: "hello unique beta" }],
        labels: [],
        edges: [],
      },
    );

    const mem1 = db
      .query<{ _id: string }, [string, string]>(
        `SELECT _id FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get("ns", "m1");
    const mem2 = db
      .query<{ _id: string }, [string, string]>(
        `SELECT _id FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get("ns", "m2");
    if (!mem1?._id || !mem2?._id) throw new Error("expected memories");

    const onlyM1 = persistence.searchLexicalSourceMapIds({
      scope: { kind: "pathSubtree", namespaces: ["ns"] },
      text: "hello",
      limit: 25,
      memoryIds: [mem1._id],
    });
    const sm1 = db
      .query<{ id: string }, [string]>(`SELECT _id AS id FROM source_maps WHERE memory_id = ?`)
      .get(mem1._id);
    const sm2 = db
      .query<{ id: string }, [string]>(`SELECT _id AS id FROM source_maps WHERE memory_id = ?`)
      .get(mem2._id);
    if (!sm1?.id || !sm2?.id) throw new Error("expected source maps");

    expect(onlyM1).toContain(sm1.id);
    expect(onlyM1).not.toContain(sm2.id);
  });

  test("searchLexicalSourceMapIds with empty memoryIds returns []", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    const r = persistence.searchLexicalSourceMapIds({
      scope: { kind: "pathSubtree", namespaces: ["ns"] },
      text: "x",
      limit: 10,
      memoryIds: [],
    });
    expect(r).toEqual([]);
  });

  test("searchVectorSourceMapIds with empty memoryIds returns []", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    const r = persistence.searchVectorSourceMapIds({
      scope: { kind: "pathSubtree", namespaces: ["ns"] },
      vector: vec512(0),
      limit: 10,
      memoryIds: [],
    });
    expect(r).toEqual([]);
  });
});

describe("neighbor sub-search", () => {
  test("listNeighborsForMemory respects NeighborFilter edge kind", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "nb",
        namespace: "ns",
        content: [{ key: "b", text: "neighbor body" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "focal",
        namespace: "ns",
        content: [{ key: "b", text: "focal body" }],
        labels: [],
        edges: [
          {
            peer_memory_id: ids.memory("ns", "nb"),
            direction: "out",
            label: { kind: "references", props: {} },
          },
        ],
      },
    );

    const matchesReferences = persistence.listNeighborsForMemory({
      namespace: "ns",
      key: "focal",
      filters: { all: [{ label: "references", direction: "out" }] },
    });
    expect(matchesReferences).toHaveLength(1);
    expect(matchesReferences[0]?.key).toBe("nb");

    const noMentions = persistence.listNeighborsForMemory({
      namespace: "ns",
      key: "focal",
      filters: { all: [{ label: "mentions", direction: "out" }] },
    });
    expect(noMentions).toEqual([]);
  });

  test("omits graph neighbor when sub-search does not match query (strict)", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "nb",
        namespace: "ns",
        content: [{ key: "b", text: "only unrelated zzz content here" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "focal",
        namespace: "ns",
        content: [{ key: "b", text: "focal unique marker alpha root" }],
        labels: [],
        edges: [
          {
            peer_memory_id: ids.memory("ns", "nb"),
            direction: "out",
            label: { kind: "references", props: {} },
          },
        ],
      },
    );

    const noMatch = search(
      { persistence },
      {
        namespace: "ns",
        content: { text: "marker alpha root" },
        options: {
          topK: 5,
          neighbors: true,
          maxNeighbors: 5,
        },
      },
    );
    const focalHit = noMatch.find((h) => h.memory.key === "focal");
    expect(focalHit).toBeDefined();
    expect(focalHit?.neighbors ?? []).toHaveLength(0);
  });

  test("includes graph neighbor when sub-search matches same query", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "nb",
        namespace: "ns",
        content: [{ key: "b", text: "ripe bananas bunch detail" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "focal",
        namespace: "ns",
        content: [{ key: "b", text: "bananas bananas bananas hub focal" }],
        labels: [],
        edges: [
          {
            peer_memory_id: ids.memory("ns", "nb"),
            direction: "out",
            label: { kind: "references", props: {} },
          },
        ],
      },
    );

    const withMatch = search(
      { persistence },
      {
        namespace: "ns",
        content: { text: "bananas" },
        options: {
          topK: 5,
          neighbors: true,
          maxNeighbors: 5,
        },
      },
    );
    const focal2 = withMatch.find((h) => h.memory.key === "focal");
    expect(focal2?.neighbors?.some((n) => n.key === "nb")).toBe(true);
  });

  test("maxNeighbors caps after ranking; neighborScore and matchedSourceMapId set", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "nb1",
        namespace: "ns",
        content: [{ key: "b", text: "first neighbor rocket ship alpha" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "nb2",
        namespace: "ns",
        content: [{ key: "b", text: "second neighbor rocket ship beta gamma" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "focal",
        namespace: "ns",
        content: [{ key: "b", text: "focal hub rocket ship" }],
        labels: [{ kind: "rootonly", props: {} }],
        edges: [
          {
            peer_memory_id: ids.memory("ns", "nb1"),
            direction: "out",
            label: { kind: "r1", props: {} },
          },
          {
            peer_memory_id: ids.memory("ns", "nb2"),
            direction: "out",
            label: { kind: "r2", props: {} },
          },
        ],
      },
    );

    const hits = search(
      { persistence },
      {
        namespace: "ns",
        content: { text: "rocket ship" },
        options: {
          topK: 10,
          neighbors: true,
          maxNeighbors: 1,
          labels: { some: ["rootonly"] },
        },
      },
    );
    const focal = hits.find((h) => h.memory.key === "focal");
    expect(focal?.neighbors).toHaveLength(1);
    const n0 = focal?.neighbors?.[0];
    expect(n0?.neighborScore).toBeDefined();
    expect(n0?.matchedSourceMapId).toBeDefined();
    expect(n0?.key === "nb1" || n0?.key === "nb2").toBe(true);
  });

  test("neighbor expansion from edge-memory root lists endpoint node memories", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "a",
        namespace: "ns",
        content: [{ key: "b", text: "endpoint alpha edgexpuniq001 rivet" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "b",
        namespace: "ns",
        content: [{ key: "b", text: "endpoint beta edgexpuniq001 rivet" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        kind: "edge",
        key: "em_ab",
        namespace: "ns",
        content: [{ key: "b", text: "edge bridge edgexpuniq001 rivet" }],
        edge: {
          from_memory_id: ids.memory("ns", "a"),
          to_memory_id: ids.memory("ns", "b"),
          label: { kind: "rel", props: {} },
        },
      },
    );

    const hits = search(
      { persistence },
      {
        namespace: "ns",
        content: { text: "edgexpuniq001 rivet" },
        options: {
          topK: 8,
          neighbors: true,
          maxNeighbors: 4,
        },
      },
    );
    const root = hits.find((h) => h.memory.key === "em_ab");
    expect(root).toBeDefined();
    expect(root?.graph.kind).toBe("edge");
    const neighborKeys = new Set((root?.neighbors ?? []).map((n) => n.key));
    expect(neighborKeys.has("a")).toBe(true);
    expect(neighborKeys.has("b")).toBe(true);
  });
});
