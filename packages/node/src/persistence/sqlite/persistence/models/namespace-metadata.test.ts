import { describe, expect, test } from "bun:test";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "../index";

describe("namespace metadata", () => {
  test("upsert, get, and list union with memory-only keys", () => {
    const db = openTestMemoriesDatabase();
    const p = createMemoriesPersistence(db);
    const now = { now: Date.now() };

    p.withTransaction(() => {
      p.upsertNamespaceMetadata(now, {
        namespace: "user/meta-only",
        alias: "Meta Only",
        description: "no memories yet",
      });
      p.upsertMemory(now, {
        namespace: "user/mem-only",
        key: "k1",
        kind: "node",
        edgeId: null,
      });
    });

    expect(p.getNamespaceMetadata("user/meta-only")).toEqual({
      namespace: "user/meta-only",
      alias: "Meta Only",
      description: "no memories yet",
    });
    expect(p.getNamespaceMetadata("user/mem-only")).toBeUndefined();

    const listed = p.listNamespacesWithMetadata();
    expect(listed.map((n) => n.namespace).sort()).toEqual(["user/mem-only", "user/meta-only"]);
    expect(listed[0]).toEqual({
      namespace: "user/mem-only",
      alias: null,
      description: "",
    });
    expect(listed[1]?.alias).toBe("Meta Only");

    p.withTransaction(() => {
      p.upsertNamespaceMetadata(now, {
        namespace: "user/mem-only",
        displayName: "Memories",
      });
      expect(p.getNamespaceMetadata("user/mem-only")?.alias).toBe("Memories");
      expect(p.getNamespaceMetadata("user/mem-only")?.description).toBe("");

      expect(() => p.upsertNamespaceMetadata(now, { namespace: "Bad/Path" })).toThrow();
    });
  });
});
