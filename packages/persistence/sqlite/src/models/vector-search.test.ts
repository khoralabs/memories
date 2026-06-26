import { describe, expect, test } from "bun:test";
import { mergeMemory } from "@khoralabs/memories-core";
import { namespacePath } from "@khoralabs/memories-persistence-core";
import { openTestMemoriesDatabase } from "../connection";
import { createMemoriesPersistence } from "../persistence";
import { findMemoryIdByKey } from "./memories";
import { prepareMemoriesSqliteStmts } from "./prepared-stmts";
import { searchVectorSourceMapIds } from "./search";

/** 512-dim float32 vector filled with a constant scalar for predictable cosine geometry. */
const makeVec = (fill: number): number[] => Array.from(new Float32Array(512).fill(fill));

const insertMemory = (
  persistence: ReturnType<typeof createMemoriesPersistence>,
  key: string,
  ns: string,
  vector: number[],
) =>
  mergeMemory(
    { persistence },
    {
      key,
      namespace: namespacePath(ns),
      content: [{ key: "body", vector }],
      labels: [],
      edges: [],
    },
  );

describe("searchVectorSourceMapIds – unscoped (vec0 MATCH path)", () => {
  test("returns vectors across all namespaces", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    insertMemory(persistence, "mem-a", "ns/a", makeVec(1.0));
    insertMemory(persistence, "mem-b", "ns/b", makeVec(0.9));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "unscoped" },
      vector: makeVec(1.0),
      limit: 10,
    });

    expect(ids.length).toBe(2);
  });

  test("respects limit", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    for (let i = 0; i < 5; i++) insertMemory(persistence, `m${i}`, `ns/${i}`, makeVec(1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "unscoped" },
      vector: makeVec(1.0),
      limit: 3,
    });

    expect(ids.length).toBe(3);
  });

  test("filters by maxVectorDistance", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    // vec(1.0) and query vec(1.0) → distance ≈ 0 (identical direction)
    insertMemory(persistence, "close", "ns/a", makeVec(1.0));
    // vec(-1.0) and query vec(1.0) → cosine distance = 1.0 (opposite)
    insertMemory(persistence, "far", "ns/b", makeVec(-1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "unscoped" },
      vector: makeVec(1.0),
      limit: 10,
      maxVectorDistance: 0.1,
    });

    // Only "close" is within the distance threshold
    expect(ids.length).toBe(1);
  });

  test("asOfTimestampMs=0 excludes all memories (created after epoch)", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    insertMemory(persistence, "mem", "ns/a", makeVec(1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "unscoped" },
      vector: makeVec(1.0),
      limit: 10,
      asOfTimestampMs: 0,
    });

    expect(ids.length).toBe(0);
  });
});

describe("searchVectorSourceMapIds – scoped (vec_distance_cosine path)", () => {
  test("pathSubtree: returns only in-namespace vectors", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    insertMemory(persistence, "target", "org/team/ns", makeVec(1.0));
    insertMemory(persistence, "noise", "other/ns", makeVec(1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "pathSubtree", namespaces: [namespacePath("org/team")] },
      vector: makeVec(1.0),
      limit: 10,
    });

    expect(ids.length).toBe(1);
  });

  test("pathSubtree: returns correct result even when out-of-scope vectors are closer", () => {
    // Regression: old post-scan code with limit=N could miss in-scope results if the
    // global top-N were all from a different namespace.
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);

    // 5 nearly-identical vectors in the wrong namespace dominate a global top-3
    for (let i = 0; i < 5; i++) insertMemory(persistence, `noise-${i}`, "other/ns", makeVec(0.99));
    // The actual target is slightly less similar but in the queried namespace
    insertMemory(persistence, "target", "target/ns", makeVec(0.9));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "pathSubtree", namespaces: [namespacePath("target/ns")] },
      vector: makeVec(1.0),
      limit: 3,
    });

    expect(ids.length).toBe(1);
  });

  test("pathSubtree: maxVectorDistance filters scoped results", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    insertMemory(persistence, "close", "ns/a", makeVec(1.0));
    insertMemory(persistence, "far", "ns/a", makeVec(-1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "pathSubtree", namespaces: [namespacePath("ns/a")] },
      vector: makeVec(1.0),
      limit: 10,
      maxVectorDistance: 0.1,
    });

    expect(ids.length).toBe(1);
  });

  test("memoryIds allowlist restricts to listed memories", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    insertMemory(persistence, "allowed", "ns/a", makeVec(1.0));
    insertMemory(persistence, "blocked", "ns/a", makeVec(1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const allowedId = findMemoryIdByKey(ctx, namespacePath("ns/a"), "allowed");
    if (!allowedId) throw new Error("allowed memory not found");

    const result = searchVectorSourceMapIds(ctx, {
      scope: { kind: "unscoped" },
      vector: makeVec(1.0),
      limit: 10,
      memoryIds: [allowedId],
    });

    expect(result.length).toBe(1);
  });

  test("empty memoryIds allowlist returns nothing", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    insertMemory(persistence, "mem", "ns/a", makeVec(1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "unscoped" },
      vector: makeVec(1.0),
      limit: 10,
      memoryIds: [],
    });

    expect(ids.length).toBe(0);
  });

  test("exactScope: returns only memories with matching scope", () => {
    const db = openTestMemoriesDatabase();
    const persistence = createMemoriesPersistence(db);
    insertMemory(persistence, "in-scope", "ns/a", makeVec(1.0));
    insertMemory(persistence, "out-scope", "ns/b", makeVec(1.0));

    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };
    const ids = searchVectorSourceMapIds(ctx, {
      scope: { kind: "exactScope", scopes: [namespacePath("ns/a")] },
      vector: makeVec(1.0),
      limit: 10,
    });

    expect(ids.length).toBe(1);
  });

  test("empty scope arrays return nothing without querying", () => {
    const db = openTestMemoriesDatabase();
    const ctx = { db, now: Date.now(), stmts: prepareMemoriesSqliteStmts(db) };

    expect(
      searchVectorSourceMapIds(ctx, {
        scope: { kind: "pathSubtree", namespaces: [] },
        vector: makeVec(1.0),
        limit: 10,
      }),
    ).toEqual([]);

    expect(
      searchVectorSourceMapIds(ctx, {
        scope: { kind: "exactScope", scopes: [] },
        vector: makeVec(1.0),
        limit: 10,
      }),
    ).toEqual([]);
  });
});
