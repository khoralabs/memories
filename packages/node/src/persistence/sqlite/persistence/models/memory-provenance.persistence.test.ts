import { describe, expect, test } from "bun:test";
import { ids, mergeMemory } from "../../../../core/index";
import {
  canonicalJson,
  computeSourceMapContentHash,
  GENESIS_PARENT_HEX,
  nextProvenanceRoot,
} from "../../../../persistence/core/provenance";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "../index";

/**
 * SQLite schema fidelity for provenance rows.
 * Chain / rollback / idempotent-delete behavior lives in the shared contract suite.
 */
describe("memory provenance SQL (SQLite)", () => {
  test("first provenance row links genesis parent and stores canonical event_json", () => {
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

    const event = {
      v: 1 as const,
      kind: "MERGE_MEMORY" as const,
      namespace,
      memory_key: key,
      memory_id: memoryId,
      source_keys: ["alpha"],
      content_hashes: {
        alpha: computeSourceMapContentHash({ text: "hello" }),
      },
    };
    expect(persistence.getProvenanceHeadRootHex()).toBe(
      nextProvenanceRoot(undefined, event).root_hex,
    );

    const row = db
      .query<{ parent_root_hex: string; event_type: string; event_json: string }, []>(
        `SELECT parent_root_hex, event_type, event_json FROM memory_provenance ORDER BY _ts_created ASC LIMIT 1`,
      )
      .get();
    expect(row?.parent_root_hex).toBe(GENESIS_PARENT_HEX);
    expect(row?.event_type).toBe("MERGE_MEMORY");
    expect(row?.event_json).toBe(canonicalJson(event));
  });

  test("appendProvenanceEvent stores contributor in event_json and intent snapshot column", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const op = { now: Date.now() };
    const event = {
      v: 1 as const,
      kind: "MERGE_MEMORY" as const,
      namespace: "ns",
      memory_key: "signed",
      memory_id: ids.memory("ns", "signed"),
      source_keys: ["source"],
      contributor: {
        v: 1 as const,
        format: "khora.direct-principal-v1",
        principal: "did:key:z-test",
        payload: "eyJ2IjoxfQ",
        signature: "MEUCIQD",
        alg: "EdDSA",
        keyId: "did:key:z-test#z-test",
      },
      intent_snapshot_id: "agent-run-1",
    };

    persistence.withTransaction(() => {
      persistence.appendProvenanceEvent(op, event);
    });

    const row = db
      .query<{ root_hex: string; event_json: string; intent_snapshot_id: string | null }, []>(
        `SELECT root_hex, event_json, intent_snapshot_id FROM memory_provenance ORDER BY _ts_created ASC LIMIT 1`,
      )
      .get();
    expect(row?.root_hex).toBe(nextProvenanceRoot(undefined, event).root_hex);
    expect(row?.event_json).toBe(canonicalJson(event));
    expect(row?.intent_snapshot_id).toBe("agent-run-1");
  });

  test("listProvenanceEvents filters by memory; listProvenanceChain paginates newest-first", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);

    mergeMemory(
      { persistence },
      {
        key: "a",
        namespace: "ns",
        content: [{ key: "s", text: "a1" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "b",
        namespace: "ns",
        content: [{ key: "s", text: "b1" }],
        labels: [],
        edges: [],
      },
    );
    mergeMemory(
      { persistence },
      {
        key: "a",
        namespace: "ns",
        content: [{ key: "s", text: "a2" }],
        labels: [],
        edges: [],
      },
    );

    const forA = persistence.listProvenanceEvents({ namespace: "ns", key: "a", limit: 10 });
    expect(forA.every((e) => (e.event as { memory_key?: string }).memory_key === "a")).toBe(true);
    expect(forA.length).toBe(2);
    expect(forA[0]?.createdAt).toBeGreaterThanOrEqual(forA[1]?.createdAt);

    const page1 = persistence.listProvenanceChain({ limit: 2 });
    expect(page1).toHaveLength(2);
    const page2 = persistence.listProvenanceChain({
      limit: 2,
      beforeRootHex: page1[1]?.rootHex,
    });
    expect(page2.length).toBeGreaterThanOrEqual(1);
    expect(page2[0]?.rootHex).not.toBe(page1[0]?.rootHex);
    expect(page2[0]?.rootHex).not.toBe(page1[1]?.rootHex);

    const eventsPage = persistence.listProvenanceEvents({
      limit: 1,
      before: { createdAt: forA[0]?.createdAt, id: forA[0]?.id },
    });
    expect(eventsPage).toHaveLength(1);
    expect(eventsPage[0]?.id).not.toBe(forA[0]?.id);
  });
});
