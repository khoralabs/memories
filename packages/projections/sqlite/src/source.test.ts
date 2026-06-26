import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { vectorToBlob } from "@khoralabs/memories-sqlite";
import {
  createSqliteGraphProjectionSource,
  loadMeanEmbeddingsForNamespace,
  loadMemoryTextPreview,
  loadSourceMapTextPreview,
} from "./source";

let db: Database | null = null;

function openProjectionTestDb(): Database {
  db = new Database(":memory:");
  db.run(
    "CREATE TABLE memories (_id TEXT PRIMARY KEY, namespace TEXT NOT NULL, key TEXT NOT NULL)",
  );
  db.run(
    "CREATE TABLE source_maps (_id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, source_key TEXT NOT NULL)",
  );
  db.run(
    "CREATE TABLE vector_features (_id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, source_map_id TEXT NOT NULL, vector BLOB NOT NULL)",
  );
  db.run(
    "CREATE TABLE text_features (_id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, source_map_id TEXT NOT NULL, text TEXT NOT NULL, _ts_created INTEGER NOT NULL)",
  );
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("SQLite graph projection source", () => {
  test("loads mean embeddings and previews", async () => {
    const db = openProjectionTestDb();
    db.run("INSERT INTO memories VALUES ('m1', 'app/user', 'note')");
    db.run("INSERT INTO memories VALUES ('m2', 'app/user/child', 'child')");
    db.run("INSERT INTO source_maps VALUES ('sm1', 'm1', 'body')");
    db.run("INSERT INTO source_maps VALUES ('sm2', 'm1', 'body-2')");
    db.run("INSERT INTO source_maps VALUES ('sm3', 'm1', '__mem_search_meta__')");
    db.run("INSERT INTO vector_features VALUES ('vf1', 'm1', 'sm1', ?)", [
      vectorToBlob(new Float32Array([1, 3])),
    ]);
    db.run("INSERT INTO vector_features VALUES ('vf2', 'm1', 'sm2', ?)", [
      vectorToBlob(new Float32Array([3, 5])),
    ]);
    db.run("INSERT INTO vector_features VALUES ('vf3', 'm1', 'sm3', ?)", [
      vectorToBlob(new Float32Array([99, 99])),
    ]);
    db.run("INSERT INTO text_features VALUES ('tf1', 'm1', 'sm1', 'hello', 1)");
    db.run("INSERT INTO text_features VALUES ('tf2', 'm1', 'sm2', 'world', 2)");

    expect(loadMeanEmbeddingsForNamespace(db, "app/user")).toEqual([
      { memoryKey: "note", memoryId: "m1", embedding: [2, 4] },
    ]);
    expect(loadMemoryTextPreview(db, "app/user", "note")).toBe("hello\n\nworld");
    expect(loadSourceMapTextPreview(db, "sm1")).toBe("hello");

    const source = createSqliteGraphProjectionSource(db);
    expect(await source.listNamespacesUnderPrefix("app/user")).toEqual([
      "app/user",
      "app/user/child",
    ]);
  });
});
