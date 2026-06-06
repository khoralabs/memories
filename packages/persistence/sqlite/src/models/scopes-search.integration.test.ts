import { describe, expect, test } from "bun:test";
import { mergeMemory, namespacePath, search } from "@khoralabs/memories-core";
import { openTestMemoriesDatabase } from "../connection";
import { createMemoriesPersistence } from "../persistence";

describe("scope DAG search (SQLite)", () => {
  test("scopeDag finds memories attached under descendant scopes", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const rootScope = namespacePath("teams/acme");
    const childScope = namespacePath("teams/acme/payments");
    const op = { now: Date.now() };
    persistence.withTransaction(() => {
      persistence.linkScopes(op, { parentScopeId: rootScope, childScopeId: childScope });
    });

    const memNs = namespacePath("docs/app");
    const token = "scopedag_sqlite_token_alp772";
    mergeMemory(
      { persistence },
      {
        key: "invoice",
        namespace: memNs,
        content: [{ key: "body", text: token }],
        labels: [],
        edges: [],
        attachScopes: [childScope],
      },
    );

    const hits = search(
      { persistence },
      {
        namespace: rootScope,
        content: { text: token },
        options: { topK: 5 },
        searchScopeMode: "scopeDag",
      },
    );
    expect(hits.some((h) => h.memory.key === "invoice")).toBe(true);
  });

  test("exactScope matches only listed scopes (no DAG descent)", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    const rootScope = namespacePath("teams/beta");
    const childScope = namespacePath("teams/beta/ledger");
    const op = { now: Date.now() };
    persistence.withTransaction(() => {
      persistence.linkScopes(op, { parentScopeId: rootScope, childScopeId: childScope });
    });

    const token = "exactscope_sqlite_token_bet884";
    mergeMemory(
      { persistence },
      {
        key: "entry",
        namespace: namespacePath("ledger/ns"),
        content: [{ key: "body", text: token }],
        labels: [],
        edges: [],
        attachScopes: [childScope],
      },
    );

    const dagHits = search(
      { persistence },
      {
        namespace: rootScope,
        content: { text: token },
        options: { topK: 5 },
        searchScopeMode: "scopeDag",
      },
    );
    expect(dagHits.some((h) => h.memory.key === "entry")).toBe(true);

    const exactParent = search(
      { persistence },
      {
        namespace: rootScope,
        content: { text: token },
        options: { topK: 5 },
        searchScopeMode: "exactScope",
      },
    );
    expect(exactParent.some((h) => h.memory.key === "entry")).toBe(false);

    const exactChild = search(
      { persistence },
      {
        namespace: childScope,
        content: { text: token },
        options: { topK: 5 },
        searchScopeMode: "exactScope",
      },
    );
    expect(exactChild.some((h) => h.memory.key === "entry")).toBe(true);
  });
});
