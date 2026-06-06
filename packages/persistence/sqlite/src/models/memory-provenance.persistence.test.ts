import { describe, expect, test } from "bun:test";
import { deleteMemory, ids, type MemoryOpContext, mergeMemory } from "@khoralabs/memories-core";
import {
  canonicalJson,
  computeSourceMapContentHash,
  GENESIS_PARENT_HEX,
  nextProvenanceRoot,
} from "@khoralabs/memories-core/provenance";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "../index";

describe("memory provenance + content_hash (SQLite)", () => {
  test("merge head matches nextProvenanceRoot from genesis; first row links genesis parent", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const namespace = "ns";
    const key = "mem";
    const memoryId = ids.memory(namespace, key);
    mergeMemory(
      { persistence },
      {
        key,
        namespace,
        content: [{ key: "alpha", text: "hello" }],
        labels: [],
        edges: [],
      },
    );

    const head = persistence.getProvenanceHeadRootHex();
    const sourceKeysSorted = ["alpha"];
    const content_hashes: Record<string, string> = {
      alpha: computeSourceMapContentHash({ text: "hello" }),
    };
    const event = {
      v: 1 as const,
      kind: "MERGE_MEMORY" as const,
      namespace,
      memory_key: key,
      memory_id: memoryId,
      source_keys: sourceKeysSorted,
      content_hashes,
    };
    expect(head).toBe(nextProvenanceRoot(undefined, event).root_hex);

    const row = db
      .query<{ parent_root_hex: string; event_type: string; event_json: string }, []>(
        `SELECT parent_root_hex, event_type, event_json FROM memory_provenance ORDER BY _ts_created ASC LIMIT 1`,
      )
      .get();
    expect(row?.parent_root_hex).toBe(GENESIS_PARENT_HEX);
    expect(row?.event_type).toBe("MERGE_MEMORY");
    expect(row?.event_json).toBe(canonicalJson(event));
  });

  test("delete advances chain; duplicate delete does not append", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "x",
        namespace: "ns",
        content: [{ key: "s", text: "a" }],
        labels: [],
        edges: [],
      },
    );
    const afterMerge = persistence.getProvenanceHeadRootHex();
    expect(afterMerge).toBeDefined();

    deleteMemory({ persistence }, { namespace: "ns", key: "x" });
    const deleteEvent = {
      v: 1 as const,
      kind: "DELETE_MEMORY" as const,
      namespace: "ns",
      memory_key: "x",
      memory_id: ids.memory("ns", "x"),
    };
    expect(persistence.getProvenanceHeadRootHex()).toBe(
      nextProvenanceRoot(afterMerge, deleteEvent).root_hex,
    );

    const n = db.query<{ c: number }, []>(`SELECT COUNT(*) as c FROM memory_provenance`).get()?.c;
    expect(n).toBe(2);

    deleteMemory({ persistence }, { namespace: "ns", key: "x" });
    const n2 = db.query<{ c: number }, []>(`SELECT COUNT(*) as c FROM memory_provenance`).get()?.c;
    expect(n2).toBe(2);
  });

  test("getProvenanceTimestampMsForRootHex matches row timestamp", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "y",
        namespace: "ns",
        content: [{ key: "s", text: "z" }],
        labels: [],
        edges: [],
      },
    );
    const head = persistence.getProvenanceHeadRootHex();
    expect(head).toBeDefined();
    if (head === undefined) {
      throw new Error("expected provenance head");
    }
    const ts = persistence.getProvenanceTimestampMsForRootHex(head);
    const rowTs = db
      .query<{ t: number }, [string]>(
        `SELECT _ts_created AS t FROM memory_provenance WHERE root_hex = ?`,
      )
      .get(head);
    expect(ts).toBe(rowTs?.t);
  });

  test("appendProvenanceEvent rolls back with the transaction on throw", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const op: MemoryOpContext = { now: Date.now() };
    expect(() =>
      persistence.withTransaction(() => {
        persistence.appendProvenanceEvent(op, {
          v: 1,
          kind: "MERGE_MEMORY",
          namespace: "ns",
          memory_key: "ghost",
          memory_id: ids.memory("ns", "ghost"),
          source_keys: ["only"],
        });
        throw new Error("abort txn");
      }),
    ).toThrow("abort txn");
    expect(persistence.getProvenanceHeadRootHex()).toBeUndefined();
  });
});
