import { describe, expect, test } from "bun:test";
import {
  assertNamespacePath,
  canonicalizeNamespacePrefixes,
  isPrefixOf,
  NAMESPACE_ABSOLUTE_MAX_DEPTH,
  NAMESPACE_MAX_PATH_LENGTH,
  namespaceFromSegments,
  namespacePath,
  namespaceSegments,
  parseNamespaceSyntax,
  resolveNamespacePathPolicy,
  zNamespacePath,
} from "./namespace-path";

describe("namespacePath / zNamespacePath", () => {
  test("accepts single segment and depth up to 6 under default policy", () => {
    expect(namespaceSegments(namespacePath("a"))).toEqual(["a"]);
    expect(namespaceSegments(namespacePath("a/b/c/d/e/f"))).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  test("rejects depth 7 under default policy", () => {
    expect(() => namespacePath("a/b/c/d/e/f/g")).toThrow();
  });

  test("accepts depth 7 when policy maxDepth is raised", () => {
    expect(assertNamespacePath("a/b/c/d/e/f/g", { maxDepth: 8 })).toBe("a/b/c/d/e/f/g");
  });

  test("accepts length 129 under new default max length", () => {
    const seg = "a".repeat(129);
    expect(seg.length).toBe(129);
    expect(seg.length).toBeLessThanOrEqual(NAMESPACE_MAX_PATH_LENGTH);
    expect(namespacePath(seg)).toBe(seg);
  });

  test("rejects over absolute max depth even with high policy", () => {
    const parts = Array.from({ length: NAMESPACE_ABSOLUTE_MAX_DEPTH + 1 }, (_, i) => `s${i}`);
    const deep = parts.join("/");
    expect(() => assertNamespacePath(deep, { maxDepth: 100 })).toThrow();
    expect(() => parseNamespaceSyntax(deep)).toThrow();
  });

  test("parseNamespaceSyntax accepts depth 7 (read path)", () => {
    expect(parseNamespaceSyntax("a/b/c/d/e/f/g")).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
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

  test("resolveNamespacePathPolicy clamps", () => {
    expect(resolveNamespacePathPolicy({ maxDepth: 100 }).maxDepth).toBe(
      NAMESPACE_ABSOLUTE_MAX_DEPTH,
    );
    expect(resolveNamespacePathPolicy({ maxDepth: 0 }).maxDepth).toBe(1);
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
