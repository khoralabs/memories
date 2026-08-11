import { describe, expect, test } from "bun:test";
import {
  namespaceEntryLabel,
  namespacePathsFromEntries,
  normalizeNamespaceEntries,
} from "./namespace-entries.ts";

describe("normalizeNamespaceEntries", () => {
  test("accepts metadata rows", () => {
    const entries = normalizeNamespaceEntries([
      { namespace: "user/a", alias: "Alpha", description: "desc", suppressed: true },
      { namespace: "user/b", alias: null, description: "" },
    ]);
    expect(entries).toEqual([
      { namespace: "user/a", alias: "Alpha", description: "desc", suppressed: true },
      { namespace: "user/b", alias: null, description: "", suppressed: false },
    ]);
    expect(namespacePathsFromEntries(entries)).toEqual(["user/a", "user/b"]);
  });

  test("skips empty namespace paths", () => {
    const entries = normalizeNamespaceEntries([
      { namespace: "  ", alias: null, description: "" },
      { namespace: "kept", alias: "K", description: "d" },
    ]);
    expect(namespacePathsFromEntries(entries)).toEqual(["kept"]);
    const kept = entries[0];
    if (kept === undefined) {
      throw new Error("expected one normalized namespace entry");
    }
    expect(namespaceEntryLabel(kept)).toBe("K");
  });
});
