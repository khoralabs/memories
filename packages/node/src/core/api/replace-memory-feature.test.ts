import { describe, expect, test } from "bun:test";
import { ids } from "../../persistence/core";
import {
  createMemoriesPersistence,
  ensureCustomSqliteForExtensions,
  openTestMemoriesDatabase,
} from "../../persistence/sqlite/persistence/index";
import { mergeMemory } from "./merge-memory";
import { replaceMemoryFeature } from "./replace-memory-feature";

ensureCustomSqliteForExtensions();

function vec512(fill = 0): number[] {
  return Array.from({ length: 512 }, () => fill);
}

function unitVec512(index = 0): number[] {
  return Array.from({ length: 512 }, (_, i) => (i === index ? 1 : 0));
}

describe("replaceMemoryFeature sibling arm", () => {
  test(
    "text-only replace preserves vector on same sourceKey",
    () => {
      const db = openTestMemoriesDatabase();
      const persistence = createMemoriesPersistence(db, { bunS3ColdStore: false });
      const namespace = "ns";
      const key = "mem";
      const sourceKey = "body";
      const vector = unitVec512(0);

      mergeMemory(
        { persistence },
        {
          key,
          namespace,
          content: [{ key: sourceKey, text: "original", vector }],
          labels: [],
          edges: [],
        },
      );

      const memoryId = persistence.findMemoryIdByKey(namespace, key);
      expect(memoryId).toBeTruthy();
      if (memoryId === undefined) throw new Error("expected memory id");
      const sourceMapId = ids.sourceMap(memoryId, sourceKey);

      const beforeVec = persistence.getSourceMapVector(sourceMapId);
      if (beforeVec === null) throw new Error("expected vector before replace");
      expect(beforeVec.length).toBe(512);
      expect(Array.from(beforeVec)).toEqual(vector);

      replaceMemoryFeature({ persistence }, { namespace, key, sourceKey, text: "replaced" });

      expect(persistence.getSourceMapText(sourceMapId)).toBe("replaced");
      const afterVec = persistence.getSourceMapVector(sourceMapId);
      if (afterVec === null) throw new Error("expected vector after text-only replace");
      expect(afterVec.length).toBe(beforeVec.length);
      expect(Array.from(afterVec)).toEqual(Array.from(beforeVec));
    },
    { timeout: 30_000 },
  );

  test(
    "vector-only replace preserves text on same sourceKey",
    () => {
      const db = openTestMemoriesDatabase();
      const persistence = createMemoriesPersistence(db, { bunS3ColdStore: false });
      const namespace = "ns";
      const key = "mem";
      const sourceKey = "body";
      const originalText = "keep-me";
      const vector = unitVec512(1);

      mergeMemory(
        { persistence },
        {
          key,
          namespace,
          content: [{ key: sourceKey, text: originalText, vector }],
          labels: [],
          edges: [],
        },
      );

      const memoryId = persistence.findMemoryIdByKey(namespace, key);
      expect(memoryId).toBeTruthy();
      if (memoryId === undefined) throw new Error("expected memory id");
      const sourceMapId = ids.sourceMap(memoryId, sourceKey);

      const nextVector = vec512(0.25);
      replaceMemoryFeature({ persistence }, { namespace, key, sourceKey, vector: nextVector });

      expect(persistence.getSourceMapText(sourceMapId)).toBe(originalText);
      const afterVec = persistence.getSourceMapVector(sourceMapId);
      if (afterVec === null) throw new Error("expected vector after vector-only replace");
      expect(afterVec.length).toBe(512);
      expect(Array.from(afterVec)).toEqual(nextVector);
    },
    { timeout: 30_000 },
  );
});
