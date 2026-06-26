import { describe, expect, test } from "bun:test";
import { mergeMemory } from "@khoralabs/memories-core";
import { namespacePath } from "@khoralabs/memories-persistence-core";
import { openTestMemoriesDatabase } from "../connection";
import { createMemoriesPersistence } from "../persistence";
import { prepareMemoriesSqliteStmts } from "./prepared-stmts";
import { searchLexicalSourceMapIds } from "./search";

describe("searchLexicalSourceMapIds namespace index", () => {
  test("subtree scope returns hits under prefix path", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "leaf",
        namespace: "org/team/ns",
        content: [{ key: "x", text: "sqlite subtree xyzzy123" }],
        labels: [],
        edges: [],
      },
    );
    const ids = searchLexicalSourceMapIds(
      { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) },
      {
        scope: { kind: "pathSubtree", namespaces: [namespacePath("org/team")] },
        text: "xyzzy123",
        limit: 10,
      },
    );
    expect(ids.length).toBeGreaterThan(0);
  });
});
