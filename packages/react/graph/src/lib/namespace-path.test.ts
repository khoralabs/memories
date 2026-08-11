import { describe, expect, test } from "bun:test";
import {
  joinNamespacePath,
  validateNamespacePath,
  validateNamespaceSegment,
} from "./namespace-path.ts";

describe("validateNamespaceSegment", () => {
  test("accepts valid segments", () => {
    expect(validateNamespaceSegment("abc")).toBeNull();
    expect(validateNamespaceSegment(" a_b-1 ")).toBeNull();
  });

  test("rejects empty and invalid", () => {
    expect(validateNamespaceSegment("")).not.toBeNull();
    expect(validateNamespaceSegment("Hello")).not.toBeNull();
    expect(validateNamespaceSegment("a/b")).not.toBeNull();
  });
});

describe("joinNamespacePath", () => {
  test("joins parent and segment", () => {
    expect(joinNamespacePath(undefined, "child")).toBe("child");
    expect(joinNamespacePath("", "child")).toBe("child");
    expect(joinNamespacePath("global", "child")).toBe("global/child");
  });
});

describe("validateNamespacePath", () => {
  test("enforces max depth under default policy", () => {
    expect(validateNamespacePath("a/b/c/d/e/f")).toBeNull();
    expect(validateNamespacePath("a/b/c/d/e/f/g")).not.toBeNull();
  });

  test("accepts deeper paths when policy is raised", () => {
    expect(validateNamespacePath("a/b/c/d/e/f/g", { maxDepth: 8 })).toBeNull();
  });

  test("accepts length 129 under default max length", () => {
    expect(validateNamespacePath("a".repeat(129))).toBeNull();
  });
});
