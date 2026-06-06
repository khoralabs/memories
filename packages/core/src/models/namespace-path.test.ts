import { describe, expect, test } from "bun:test";
import {
  canonicalizeNamespacePrefixes,
  isPrefixOf,
  namespaceFromSegments,
  namespacePath,
  namespacePrefixFieldForDepth,
  namespacePrefixFieldForDepthCamel,
  namespacePrefixFields,
  namespacePrefixFieldsCamel,
  namespaceSegments,
  zNamespacePath,
} from "./namespace-path";

describe("namespacePath / zNamespacePath", () => {
  test("accepts single segment and depth up to 6", () => {
    expect(namespaceSegments(namespacePath("a"))).toEqual(["a"]);
    expect(namespaceSegments(namespacePath("a/b/c/d/e/f"))).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  test("rejects empty, slashes, bad chars", () => {
    expect(() => namespacePath("")).toThrow();
    expect(() => namespacePath("/a")).toThrow();
    expect(() => namespacePath("a/")).toThrow();
    expect(() => namespacePath("a//b")).toThrow();
    expect(() => namespacePath("A")).toThrow();
    expect(() => namespacePath("a.b")).toThrow();
  });

  test("zNamespacePath parses valid paths", () => {
    expect(zNamespacePath.parse("ns1")).toBe("ns1");
    expect(zNamespacePath.safeParse("bad!").success).toBe(false);
  });
});

describe("isPrefixOf", () => {
  test("prefix and equality", () => {
    const root = namespacePath("agents");
    const mid = namespacePath("agents/acme");
    const leaf = namespacePath("agents/acme/mem");
    expect(isPrefixOf(root, mid)).toBe(true);
    expect(isPrefixOf(mid, leaf)).toBe(true);
    expect(isPrefixOf(mid, mid)).toBe(true);
    expect(isPrefixOf(namespacePath("other"), leaf)).toBe(false);
  });
});

describe("canonicalizeNamespacePrefixes", () => {
  test("drops strict descendants", () => {
    const a = namespacePath("agents");
    const b = namespacePath("agents/acme");
    const out = canonicalizeNamespacePrefixes([b, a]);
    expect(out).toEqual([a]);
  });

  test("keeps disjoint roots", () => {
    const x = namespacePath("a");
    const y = namespacePath("b");
    expect(canonicalizeNamespacePrefixes([x, y]).map(String).sort()).toEqual(["a", "b"]);
  });
});

describe("namespaceFromSegments", () => {
  test("roundtrip", () => {
    const p = namespaceFromSegments(["x", "y"]);
    expect(namespaceSegments(p)).toEqual(["x", "y"]);
  });
});

describe("namespacePrefixFields / namespacePrefixFieldForDepth", () => {
  test("cumulative prefixes for subtree filters", () => {
    const p = namespacePath("a/b/c");
    expect(namespacePrefixFields(p)).toEqual({
      ns_prefix_1: "a",
      ns_prefix_2: "a/b",
      ns_prefix_3: "a/b/c",
    });
  });

  test("field name matches segment depth", () => {
    expect(namespacePrefixFieldForDepth(1)).toBe("ns_prefix_1");
    expect(namespacePrefixFieldForDepth(3)).toBe("ns_prefix_3");
  });
});

describe("namespacePrefixFieldsCamel / namespacePrefixFieldForDepthCamel", () => {
  test("cumulative prefixes for Convex subtree filters", () => {
    const p = namespacePath("a/b/c");
    expect(namespacePrefixFieldsCamel(p)).toEqual({
      nsPrefix1: "a",
      nsPrefix2: "a/b",
      nsPrefix3: "a/b/c",
    });
  });

  test("field name matches segment depth", () => {
    expect(namespacePrefixFieldForDepthCamel(1)).toBe("nsPrefix1");
    expect(namespacePrefixFieldForDepthCamel(3)).toBe("nsPrefix3");
  });
});
