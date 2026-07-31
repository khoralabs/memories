import { describe, expect, test } from "bun:test";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "../index";

describe("namespace metadata", () => {
  test(
    "upsert, get, and list union with memory-only keys",
    () => {
      const db = openTestMemoriesDatabase();
      const p = createMemoriesPersistence(db);
      const now = { now: Date.now() };

      p.upsertNamespaceMetadata(now, {
        namespace: "user/meta-only",
        displayName: "Meta Only",
        description: "before memories",
      });

      p.upsertMemory(now, {
        namespace: "user/mem-only",
        key: "k1",
        kind: "node",
      });

      expect(p.getNamespaceMetadata("user/meta-only")).toEqual({
        namespace: "user/meta-only",
        displayName: "Meta Only",
        description: "before memories",
      });
      expect(p.getNamespaceMetadata("user/mem-only")).toBeUndefined();

      const listed = p.listNamespacesWithMetadata();
      expect(listed.map((n) => n.namespace)).toEqual(["user/mem-only", "user/meta-only"]);
      expect(listed[0]).toEqual({
        namespace: "user/mem-only",
        displayName: null,
        description: "",
      });
      expect(listed[1]?.displayName).toBe("Meta Only");

      p.upsertNamespaceMetadata(now, {
        namespace: "user/mem-only",
        displayName: "Memories",
      });
      expect(p.getNamespaceMetadata("user/mem-only")?.displayName).toBe("Memories");
      expect(p.getNamespaceMetadata("user/mem-only")?.description).toBe("");

      expect(() => p.upsertNamespaceMetadata(now, { namespace: "Bad/Path" })).toThrow();
      db.close();
    },
    { timeout: 30_000 },
  );
});
