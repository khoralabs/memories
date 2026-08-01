import { describe, expect, test } from "bun:test";
import { asOfSqlClause, normalizeSearchAsOf } from "./search-asof";

describe("normalizeSearchAsOf", () => {
  test("undefined when neither set", () => {
    expect(normalizeSearchAsOf({})).toBeUndefined();
  });

  test("asOfTimestampMs aliases to lte", () => {
    expect(normalizeSearchAsOf({ asOfTimestampMs: 10 })).toEqual({ lte: 10 });
  });

  test("merges asOfTimestampMs into asOf when lte omitted", () => {
    expect(normalizeSearchAsOf({ asOf: { gt: 1 }, asOfTimestampMs: 10 })).toEqual({
      gt: 1,
      lte: 10,
    });
  });

  test("allows matching asOf.lte and asOfTimestampMs", () => {
    expect(normalizeSearchAsOf({ asOf: { lte: 10 }, asOfTimestampMs: 10 })).toEqual({ lte: 10 });
  });

  test("rejects conflicting lte and asOfTimestampMs", () => {
    expect(() => normalizeSearchAsOf({ asOf: { lte: 1 }, asOfTimestampMs: 2 })).toThrow(/conflict/);
  });

  test("rejects empty asOf", () => {
    expect(() => normalizeSearchAsOf({ asOf: {} })).toThrow(/at least one/);
  });

  test("rejects lower bound exceeding upper bound", () => {
    expect(() => normalizeSearchAsOf({ asOf: { gte: 20, lte: 10 } })).toThrow(/exceeds/);
  });
});

describe("asOfSqlClause", () => {
  test("emits ops in stable order", () => {
    expect(asOfSqlClause({ gt: 1, gte: 2, lt: 3, lte: 4 }, "_ts_created")).toEqual({
      sql: " AND _ts_created > ? AND _ts_created >= ? AND _ts_created < ? AND _ts_created <= ?",
      bindings: [1, 2, 3, 4],
    });
  });
});
