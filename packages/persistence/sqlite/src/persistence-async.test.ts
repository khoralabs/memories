import { describe, expect, test } from "bun:test";
import { mergeMemoryAsync } from "@khoralabs/memories-core";
import { memoriesSqliteVecAvailable, openTestMemoriesDatabase } from "./connection";
import { createMemoriesPersistence, createMemoriesPersistenceAsync } from "./index";

describe("createMemoriesPersistenceAsync", () => {
  test.skipIf(!memoriesSqliteVecAvailable())("mergeMemoryAsync persists a memory row", async () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistenceAsync(db);
    await mergeMemoryAsync(
      { persistence },
      {
        namespace: "test/ns",
        key: "k1",
        content: [{ key: "body", text: "hello async" }],
        labels: [],
        edges: [],
      },
    );
    const sync = createMemoriesPersistence(db);
    expect(sync.findMemoryIdByKey("test/ns", "k1")).toBeDefined();
    db.close();
  });
});
