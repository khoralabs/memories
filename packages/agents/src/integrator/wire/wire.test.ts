import { describe, expect, test } from "bun:test";

import { joinIntegrateLexical, parseIntegrateMemoryEvent } from "./memory-event.ts";
import {
  parseIntegrateMemoryWriteScope,
  resolveWriteNamespaceChoice,
  writeScopeNamespaceCandidates,
  writeScopeNeedsNamespaceChoice,
  writeScopeNeighborSearchOptions,
} from "./write-scope.ts";

describe("parseIntegrateMemoryWriteScope", () => {
  test("accepts valid scopes", () => {
    expect(parseIntegrateMemoryWriteScope("exact")).toBe("exact");
    expect(parseIntegrateMemoryWriteScope("under")).toBe("under");
    expect(parseIntegrateMemoryWriteScope("cross")).toBe("cross");
  });

  test("rejects invalid scopes", () => {
    expect(() => parseIntegrateMemoryWriteScope("anywhere")).toThrow(/writeScope/);
  });
});

describe("parseIntegrateMemoryEvent", () => {
  test("parses a memory deepen event", () => {
    const event = parseIntegrateMemoryEvent({
      kind: "memory",
      ownerKey: "did:key:abc",
      namespace: "notes",
      memoryKey: "intro",
      correlationId: "corr-1",
      occurredAtMs: 1_700_000_000_000,
      payload: { source: "writeMemory" },
      features: { lexical: ["hello"], vector: [] },
      instructions: "",
    });
    expect(event.kind).toBe("memory");
    expect(event.memoryKey).toBe("intro");
  });

  test("rejects missing required fields", () => {
    expect(() => parseIntegrateMemoryEvent(null)).toThrow(/object/);
    expect(() =>
      parseIntegrateMemoryEvent({
        kind: "interaction",
        ownerKey: "",
        namespace: "notes",
        correlationId: "c1",
        occurredAtMs: 1,
        payload: {},
        features: { lexical: ["x"], vector: [] },
      }),
    ).toThrow(/ownerKey/);
    expect(() =>
      parseIntegrateMemoryEvent({
        kind: "memory",
        ownerKey: "did:key:abc",
        namespace: "notes",
        correlationId: "c1",
        occurredAtMs: 1,
        payload: {},
        features: { lexical: ["x"], vector: [] },
      }),
    ).toThrow(/memoryKey/);
  });

  test("rejects whitespace-only lexical features when vector is empty", () => {
    expect(() =>
      parseIntegrateMemoryEvent({
        kind: "interaction",
        ownerKey: "did:key:abc",
        namespace: "notes",
        correlationId: "c1",
        occurredAtMs: 1,
        payload: {},
        features: { lexical: ["  ", ""], vector: [] },
      }),
    ).toThrow(/features/);
  });

  test("trims lexical feature strings", () => {
    const event = parseIntegrateMemoryEvent({
      kind: "interaction",
      ownerKey: "did:key:abc",
      namespace: "notes",
      correlationId: "c1",
      occurredAtMs: 1,
      payload: {},
      features: { lexical: ["  hello  ", ""], vector: [] },
      instructions: "",
    });
    expect(event.features.lexical).toEqual(["hello"]);
  });
});

describe("joinIntegrateLexical", () => {
  test("joins non-empty lexical rows", () => {
    expect(joinIntegrateLexical({ lexical: ["a", "  ", "b"], vector: [] })).toBe("a\n\nb");
  });
});

describe("writeScopeNamespaceCandidates", () => {
  test("returns seed only for exact scope", () => {
    expect(writeScopeNamespaceCandidates("exact", "notes", ["notes", "notes/a"])).toEqual([
      "notes",
    ]);
  });
});

describe("writeScopeNeighborSearchOptions", () => {
  test("cross searches entire database", () => {
    expect(writeScopeNeighborSearchOptions("cross", "ns/a")).toEqual({
      namespace: "ns/a",
      searchEntireDatabase: true,
    });
  });

  test("under uses pathSubtree", () => {
    expect(writeScopeNeighborSearchOptions("under", "ns/a")).toEqual({
      namespace: "ns/a",
      searchScopeMode: "pathSubtree",
    });
  });

  test("exact and undefined stay on the seed namespace", () => {
    expect(writeScopeNeighborSearchOptions("exact", "ns/a")).toEqual({ namespace: "ns/a" });
    expect(writeScopeNeighborSearchOptions(undefined, "ns/a")).toEqual({ namespace: "ns/a" });
  });
});

describe("writeScopeNeedsNamespaceChoice", () => {
  test("true for under and cross only", () => {
    expect(writeScopeNeedsNamespaceChoice("under")).toBe(true);
    expect(writeScopeNeedsNamespaceChoice("cross")).toBe(true);
    expect(writeScopeNeedsNamespaceChoice("exact")).toBe(false);
    expect(writeScopeNeedsNamespaceChoice(undefined)).toBe(false);
  });
});

describe("resolveWriteNamespaceChoice", () => {
  const slugify = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  test("returns exact candidate matches", () => {
    expect(
      resolveWriteNamespaceChoice({
        scope: "under",
        seedNamespace: "notes",
        candidates: ["notes", "notes/a"],
        choice: "notes/a",
        slugifySegment: slugify,
      }),
    ).toBe("notes/a");
  });

  test("allows one new child under seed for under scope", () => {
    expect(
      resolveWriteNamespaceChoice({
        scope: "under",
        seedNamespace: "notes",
        candidates: ["notes"],
        choice: "notes/New Topic",
        slugifySegment: slugify,
      }),
    ).toBe("notes/new-topic");
  });

  test("falls back to seed for invalid choices", () => {
    expect(
      resolveWriteNamespaceChoice({
        scope: "exact",
        seedNamespace: "notes",
        candidates: ["notes"],
        choice: "other",
        slugifySegment: slugify,
      }),
    ).toBe("notes");
  });
});
