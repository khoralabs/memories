import { describe, expect, test } from "bun:test";
import { asOfSqlClause, normalizeSearchAsOf } from "./search-asof";

describe("normalizeSearchAsOf", () => {
  test("undefined when asOf unset", () => {
    expect(normalizeSearchAsOf({})).toBeUndefined();
  });

  test("passes through asOf.lte", () => {
    expect(normalizeSearchAsOf({ asOf: { lte: 10 } })).toEqual({ lte: 10 });
  });

  test("passes through combined bounds", () => {
    expect(normalizeSearchAsOf({ asOf: { gt: 1, lte: 10 } })).toEqual({
      gt: 1,
      lte: 10,
    });
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
