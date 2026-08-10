import { describe, expect, test } from "bun:test";
import {
  formatEdgeLabelKind,
  formatNodeLabelKind,
  formatOntologyLabelChain,
} from "../memory-detail-ontology.tsx";
import { firstContentExcerpt } from "../memory-relation-hovers.tsx";
import { isReservedContentSourceKey, userContentArms } from "./memory-merge.ts";
import { resolveMemoryPathIdentity } from "./memory-path.ts";
import { entriesToProperties, propertiesToEntries } from "./memory-properties.ts";

describe("ontology formatters", () => {
  test("formats node kinds as PascalCase", () => {
    expect(formatNodeLabelKind("person")).toBe("Person");
    expect(formatNodeLabelKind("some_fact")).toBe("SomeFact");
  });

  test("formats edge kinds as UPPERCASE", () => {
    expect(formatEdgeLabelKind("references")).toBe("REFERENCES");
    expect(formatEdgeLabelKind("related_to")).toBe("RELATED_TO");
  });

  test("joins ontology chains", () => {
    expect(formatOntologyLabelChain(["person", "event"], "node")).toBe("Person:Event");
    expect(formatOntologyLabelChain(["includes", "related_to"], "edge")).toBe(
      "INCLUDES:RELATED_TO",
    );
  });
});

describe("resolveMemoryPathIdentity", () => {
  test("splits qualified keys", () => {
    expect(resolveMemoryPathIdentity("ns", "agents/a::k1")).toEqual({
      namespace: "agents/a",
      key: "k1",
    });
  });

  test("leaves unqualified keys unchanged", () => {
    expect(resolveMemoryPathIdentity("ns", "plain")).toEqual({
      namespace: "ns",
      key: "plain",
    });
  });
});

describe("memory-merge helpers", () => {
  test("reserved source keys", () => {
    expect(isReservedContentSourceKey("__search")).toBe(true);
    expect(isReservedContentSourceKey("body")).toBe(false);
  });

  test("userContentArms filters reserved", () => {
    expect(
      userContentArms([
        { sourceKey: "__meta", text: "x" },
        { sourceKey: "body", text: "hi" },
      ]),
    ).toEqual([{ sourceKey: "body", text: "hi" }]);
  });
});

describe("properties round-trip", () => {
  test("entriesToProperties parses JSON-ish values", () => {
    const entries = propertiesToEntries({ a: "hello", n: 1, flag: true });
    expect(entries.map((e) => e.key).sort()).toEqual(["a", "flag", "n"]);
    const back = entriesToProperties([
      { id: "1", key: "a", value: "hello" },
      { id: "2", key: "n", value: "1" },
      { id: "3", key: "flag", value: "true" },
      { id: "4", key: "obj", value: '{"x":1}' },
    ]);
    expect(back).toEqual({
      a: "hello",
      n: 1,
      flag: true,
      obj: { x: 1 },
    });
  });
});

describe("firstContentExcerpt", () => {
  test("returns first non-empty arm, truncated", () => {
    expect(firstContentExcerpt([{ sourceKey: "a", text: "  " }])).toBeNull();
    expect(firstContentExcerpt([{ sourceKey: "a", text: "hello world" }], 5)).toBe("hello…");
  });
});
