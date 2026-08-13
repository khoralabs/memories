import { describe, expect, test } from "bun:test";
import {
  buildProvenanceEventsQuery,
  clampProvenanceListLimit,
  isValidProvenanceCursorId,
  mapProvenanceChainRow,
  mapProvenanceEventRow,
  normalizeProvenanceChainInput,
  PROVENANCE_LIST_LIMIT_MAX,
} from "./provenance-list-sql";

describe("provenance-list-sql", () => {
  test("clampProvenanceListLimit rejects non-positive", () => {
    expect(() => clampProvenanceListLimit(0)).toThrow(RangeError);
    expect(clampProvenanceListLimit(1000)).toBe(PROVENANCE_LIST_LIMIT_MAX);
  });

  test("isValidProvenanceCursorId", () => {
    expect(isValidProvenanceCursorId("")).toBe(false);
    expect(isValidProvenanceCursorId("abc")).toBe(true);
  });

  test("buildProvenanceEventsQuery requires namespace when key set", () => {
    expect(() => buildProvenanceEventsQuery({ key: "k", limit: 10 })).toThrow(RangeError);
  });

  test("buildProvenanceEventsQuery arg order", () => {
    const { params } = buildProvenanceEventsQuery({
      namespace: "ns",
      key: "k",
      limit: 5,
      before: { createdAt: 9, id: "id1" },
    });
    expect(params).toEqual(["ns", "ns", "ns", "ns", "k", "k", 9, 9, 9, "id1", 5]);
  });

  test("mapProvenanceEventRow parses event json", () => {
    const item = mapProvenanceEventRow({
      _id: "1",
      root_hex: "r",
      parent_root_hex: "p",
      event_type: "MERGE_MEMORY",
      _ts_created: 1,
      event_json: JSON.stringify({
        kind: "MERGE_MEMORY",
        namespace: "ns",
        memory_key: "k",
      }),
      intent_snapshot_id: null,
    });
    expect(item.eventType).toBe("MERGE_MEMORY");
    expect(item.event).toMatchObject({
      kind: "MERGE_MEMORY",
      namespace: "ns",
      memory_key: "k",
    });
  });

  test("mapProvenanceChainRow and normalize", () => {
    expect(normalizeProvenanceChainInput({ limit: 3, beforeRootHex: "  ab  " })).toEqual({
      limit: 3,
      beforeRootHex: "ab",
    });
    expect(
      mapProvenanceChainRow({
        _id: "1",
        root_hex: "r",
        parent_root_hex: "p",
        event_type: "MERGE_MEMORY",
        _ts_created: 2,
      }),
    ).toEqual({
      id: "1",
      rootHex: "r",
      parentRootHex: "p",
      eventType: "MERGE_MEMORY",
      createdAt: 2,
    });
  });
});
