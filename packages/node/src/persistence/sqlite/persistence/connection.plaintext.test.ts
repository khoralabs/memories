import { describe, expect, test } from "bun:test";
import { openMemoriesDatabase } from "./connection";

describe("openMemoriesDatabase plaintext", () => {
  test("opens without sqlCipherKey and applies schema", () => {
    const db = openMemoriesDatabase(":memory:");
    try {
      const memories = db
        .query<{ name: string }, []>("PRAGMA table_info(memories)")
        .all()
        .map((r) => r.name);
      expect(memories.includes("kind")).toBe(true);
      expect(memories.includes("edge_id")).toBe(true);
    } finally {
      db.close();
    }
  });
});
