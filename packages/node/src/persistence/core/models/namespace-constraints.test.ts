import { describe, expect, test } from "bun:test";

import { assertNamespaceCountAllowsNew, NamespaceConstraintError } from "./namespace-constraints";
import { assertNamespacePath, namespacePath } from "./namespace-path";

describe("NamespaceConstraintError", () => {
  test("depth 7 throws max_depth", () => {
    expect(() => namespacePath("a/b/c/d/e/f/g")).toThrow(NamespaceConstraintError);
    try {
      namespacePath("a/b/c/d/e/f/g");
    } catch (e) {
      expect(e).toBeInstanceOf(NamespaceConstraintError);
      expect((e as NamespaceConstraintError).code).toBe("max_depth");
    }
  });

  test("invalid segment throws invalid_path", () => {
    try {
      assertNamespacePath("Bad/Path");
    } catch (e) {
      expect(e).toBeInstanceOf(NamespaceConstraintError);
      expect((e as NamespaceConstraintError).code).toBe("invalid_path");
    }
  });

  test("assertNamespaceCountAllowsNew allows existing and rejects over cap", () => {
    const existing = ["a", "b"];
    expect(() => assertNamespaceCountAllowsNew(existing, "a", 2)).not.toThrow();
    expect(() => assertNamespaceCountAllowsNew(existing, "c", 2)).toThrow(NamespaceConstraintError);
    try {
      assertNamespaceCountAllowsNew(existing, "c", 2);
    } catch (e) {
      expect((e as NamespaceConstraintError).code).toBe("max_namespaces");
    }
    expect(() => assertNamespaceCountAllowsNew(existing, "c", undefined)).not.toThrow();
  });

  test("unset maxNamespaces is unbounded (no check)", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => `ns/${i}`);
    expect(() => assertNamespaceCountAllowsNew(many, "ns/new", undefined)).not.toThrow();
  });
});
