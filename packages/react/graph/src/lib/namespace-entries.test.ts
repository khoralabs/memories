import { describe, expect, test } from "bun:test";
import {
  namespaceEntryLabel,
  namespacePathsFromEntries,
  normalizeNamespaceEntries,
} from "./namespace-entries.ts";

describe("normalizeNamespaceEntries", () => {
  test("accepts legacy string[]", () => {
    const entries = normalizeNamespaceEntries(["user/a", " user/b "]);
    expect(entries).toEqual([
      { namespace: "user/a", alias: null, description: "", suppressed: false },
      { namespace: "user/b", alias: null, description: "", suppressed: false },
    ]);
    expect(namespacePathsFromEntries(entries)).toEqual(["user/a", "user/b"]);
  });

  test("accepts metadata rows", () => {
    const entries = normalizeNamespaceEntries([
      { namespace: "user/a", alias: "Alpha", description: "desc", suppressed: true },
      { namespace: "user/b", alias: null, description: "" },
    ]);
    expect(entries).toEqual([
      { namespace: "user/a", alias: "Alpha", description: "desc", suppressed: true },
      { namespace: "user/b", alias: null, description: "", suppressed: false },
    ]);
  });

  test("mixed payload", () => {
    const entries = normalizeNamespaceEntries([
      "plain",
      { namespace: "meta", alias: "M", description: "d" },
    ]);
    expect(namespacePathsFromEntries(entries)).toEqual(["plain", "meta"]);
    const plain = entries[0];
    const meta = entries[1];
    if (plain === undefined || meta === undefined) {
      throw new Error("expected two normalized namespace entries");
    }
    expect(namespaceEntryLabel(meta)).toBe("M");
    expect(namespaceEntryLabel(plain)).toBe("plain");
  });
});
