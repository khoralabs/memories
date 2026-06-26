import { describe, expect, test } from "bun:test";
import type {
  SourceMap,
  SourceMapLocators,
} from "@khoralabs/memories-persistence-core/persistence";
import type { ResolvedSource, SourceRef } from "@khoralabs/sourcemaps";

describe("SourceMap ref contract", () => {
  test("SourceMap satisfies SourceRef<SourceMapLocators>", () => {
    const sm: SourceMap = { memory_id: "mem_1", source_key: "body" };
    const ref: SourceRef<SourceMapLocators> = sm;
    expect(ref.memory_id).toBe("mem_1");
  });
});

describe("ResolvedSource", () => {
  test("json kind carries unparsed body", () => {
    const r: ResolvedSource = { kind: "json", body: '{"x":1}' };
    expect(r.kind).toBe("json");
    if (r.kind === "json") {
      expect(r.body).toBe('{"x":1}');
    }
  });

  test("record kind narrows value with domain", () => {
    type EM = { profile: { id: string } };
    const r: ResolvedSource<EM> = {
      kind: "record",
      domain: "profile",
      entity_id: "p1",
      value: { id: "p1" },
    };
    if (r.kind === "record" && r.domain === "profile") {
      expect(r.value.id).toBe("p1");
    }
  });
});
