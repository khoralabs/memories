import { describe, expect, test } from "bun:test";
import {
  buildFtsMatchFromUserText,
  memoriesWhereClauseFromScope,
  memoryIdSubqueryFromScope,
  vector32Json,
  vectorByteLength,
} from "./sql";

describe("buildFtsMatchFromUserText", () => {
  test("returns empty for blank input", () => {
    expect(buildFtsMatchFromUserText("   ")).toBe("");
  });

  test("AND-combines tokens with phrase and prefix clauses", () => {
    const q = buildFtsMatchFromUserText("hello world");
    expect(q).toContain("hello");
    expect(q).toContain("world");
    expect(q).toContain(" AND ");
  });
});

describe("scope SQL helpers", () => {
  test("unscoped filter is permissive", () => {
    const { sql, bindings } = memoriesWhereClauseFromScope({ kind: "unscoped" }, undefined);
    expect(sql).toStartWith("1 = 1");
    expect(bindings).toEqual([]);
  });

  test("pathSubtree with empty namespaces is false", () => {
    const { sql } = memoriesWhereClauseFromScope(
      { kind: "pathSubtree", namespaces: [] },
      undefined,
    );
    expect(sql).toBe("1 = 0");
  });

  test("memoryIdSubquery wraps memories filter", () => {
    const { sql } = memoryIdSubqueryFromScope({ kind: "unscoped" }, undefined, undefined, "tf");
    expect(sql).toContain("tf.memory_id IN");
  });
});

describe("vector helpers", () => {
  test("vector32Json serializes float arrays", () => {
    expect(vector32Json(new Float32Array([1, 2, 3]))).toBe("[1,2,3]");
  });

  test("vectorByteLength matches float32 width", () => {
    expect(vectorByteLength(768)).toBe(768 * 4);
  });
});
