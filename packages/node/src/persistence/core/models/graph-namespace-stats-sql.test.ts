import { describe, expect, test } from "bun:test";
import {
  foldKindCountRows,
  GRAPH_EDGE_NOT_SUPPRESSED,
  sqlCountDistinctEdges,
  sqlCountNodes,
  sqlNodeKeys,
  suppressedEdgeCountFromTotals,
} from "./graph-namespace-stats-sql";

describe("graph-namespace-stats-sql", () => {
  test("GRAPH_EDGE_NOT_SUPPRESSED uses substr namespace boundary", () => {
    expect(GRAPH_EDGE_NOT_SUPPRESSED).toContain("substr(mf.namespace");
    expect(GRAPH_EDGE_NOT_SUPPRESSED).toContain("substr(mt.namespace");
  });

  test("sqlCountDistinctEdges toggles filter", () => {
    expect(sqlCountDistinctEdges(true)).not.toContain("mf.suppressed = 0");
    expect(sqlCountDistinctEdges(false)).toContain("mf.suppressed = 0");
  });

  test("sqlCountNodes and sqlNodeKeys", () => {
    expect(sqlCountNodes(false)).toContain("suppressed = 0");
    expect(sqlNodeKeys(true)).not.toContain("suppressed = 0");
  });

  test("foldKindCountRows and suppressedEdgeCountFromTotals", () => {
    expect(
      foldKindCountRows([
        { kind: "a", c: 2 },
        { kind: "b", c: 1 },
      ]),
    ).toEqual({
      a: 2,
      b: 1,
    });
    expect(suppressedEdgeCountFromTotals(5, 3)).toBe(2);
    expect(suppressedEdgeCountFromTotals(1, 3)).toBe(0);
  });
});
