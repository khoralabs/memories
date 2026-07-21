import { describe, expect, test } from "bun:test";
import { ids } from "@khoralabs/memories-persistence-core";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "../sqlite/persistence/index";
import { mergeMemory } from "./api/merge-memory";
import { search } from "./api/search";
import {
  MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX,
  MEMORY_NODE_LABEL_PROPS_KEY_PREFIX,
} from "./search-meta-constants";

function openTestDb() {
  return openTestMemoriesDatabase();
}

describe("label props search features", () => {
  test("lexical search finds text only indexed on label props chunk", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    const unique = "lexpropunique767";
    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "c", text: "boring generic content alpha" }],
        labels: [
          {
            kind: "person",
            props: {
              name: "Pat",
              role: unique,
            },
          },
        ],
        edges: [],
      },
    );

    const hits = search(
      { persistence },
      { namespace: "ns", content: { text: unique }, options: { topK: 10 } },
    );
    expect(
      hits.some(
        (h) => h.memory.key === "m1" && h.source_key.startsWith(MEMORY_NODE_LABEL_PROPS_KEY_PREFIX),
      ),
    ).toBe(true);
  });

  test("supersession removes prior label props source map when label value changes", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    const v1 = "supersedeone999";
    const v2 = "supersedetwo999";

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "c", text: "body" }],
        labels: [{ kind: "person", props: { name: "A", role: v1 } }],
        edges: [],
      },
    );

    const memId = ids.memory("ns", "m1");
    const countMaps = () =>
      db
        .query<{ n: number }, [string]>(
          `SELECT COUNT(*) AS n FROM source_maps WHERE memory_id = ? AND source_key LIKE '__mem_nl_props__%'`,
        )
        .get(memId)?.n;

    expect(countMaps()).toBe(1);
    expect(
      search({ persistence }, { namespace: "ns", content: { text: v1 }, options: { topK: 3 } })
        .length,
    ).toBeGreaterThanOrEqual(1);

    mergeMemory(
      { persistence },
      {
        key: "m1",
        namespace: "ns",
        content: [{ key: "c", text: "body" }],
        labels: [{ kind: "person", props: { name: "A", role: v2 } }],
        edges: [],
      },
    );

    expect(countMaps()).toBe(1);
    expect(
      search({ persistence }, { namespace: "ns", content: { text: v1 }, options: { topK: 3 } }),
    ).toEqual([]);
    expect(
      search({ persistence }, { namespace: "ns", content: { text: v2 }, options: { topK: 3 } })
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("edge label props chunk is searchable from edge memory", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    const edgeToken = "edgeproptok888";

    mergeMemory(
      { persistence },
      {
        key: "nb",
        namespace: "ns",
        content: [{ key: "c", text: "neighbor blob" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "focal",
        namespace: "ns",
        content: [{ key: "c", text: "focal blob" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        kind: "edge",
        key: "em_focal_nb",
        namespace: "ns",
        content: [{ key: "c", text: "edge body" }],
        edge: {
          from_memory_id: ids.memory("ns", "focal"),
          to_memory_id: ids.memory("ns", "nb"),
          label: { kind: "causes", props: { mechanism: edgeToken } },
        },
      },
    );

    const hits = search(
      { persistence },
      { namespace: "ns", content: { text: edgeToken }, options: { topK: 10 } },
    );
    expect(
      hits.some(
        (h) =>
          h.memory.key === "em_focal_nb" &&
          h.source_key.startsWith(MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX),
      ),
    ).toBe(true);
  });

  test("edge label props are not denormalized onto endpoint node memories", () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    const edgeToken = "neighborfind999";

    mergeMemory(
      { persistence },
      {
        key: "nb",
        namespace: "ns",
        content: [{ key: "c", text: "nb only" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "focal",
        namespace: "ns",
        content: [{ key: "c", text: "focal only" }],
        labels: [],
        edges: [],
      },
    );

    mergeMemory(
      { persistence },
      {
        kind: "edge",
        key: "em_desc",
        namespace: "ns",
        content: [{ key: "c", text: "edge chunk" }],
        edge: {
          from_memory_id: ids.memory("ns", "focal"),
          to_memory_id: ids.memory("ns", "nb"),
          label: { kind: "describes", props: { facet: edgeToken } },
        },
      },
    );

    const hits = search(
      { persistence },
      { namespace: "ns", content: { text: edgeToken }, options: { topK: 10 } },
    );
    expect(hits.some((h) => h.memory.key === "nb" || h.memory.key === "focal")).toBe(false);
    expect(
      hits.some(
        (h) =>
          h.memory.key === "em_desc" && h.source_key.startsWith(MEMORY_EDGE_LABEL_PROPS_KEY_PREFIX),
      ),
    ).toBe(true);
  });
});
