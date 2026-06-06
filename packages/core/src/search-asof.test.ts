import { describe, expect, test } from "bun:test";
import { createMemoriesPersistence, openTestMemoriesDatabase } from "@khoralabs/memories-sqlite";
import { mergeMemory } from "./api/merge-memory";
import { search } from "./api/search";

function openTestDb() {
  return openTestMemoriesDatabase();
}

describe("search asOfTimestampMs", () => {
  test("excludes memories created after the cutoff", async () => {
    const db = openTestDb();
    const persistence = createMemoriesPersistence(db);
    mergeMemory(
      { persistence },
      {
        key: "early",
        namespace: "ns",
        content: [{ key: "s", text: "asof_marker_early_unique" }],
        labels: [],
        edges: [],
      },
    );
    const rowEarly = db
      .query<{ t: number }, [string, string]>(
        `SELECT _ts_created AS t FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get("ns", "early");
    if (rowEarly === null) throw new Error("expected early memory");
    await Bun.sleep(5);
    mergeMemory(
      { persistence },
      {
        key: "late",
        namespace: "ns",
        content: [{ key: "s", text: "asof_marker_early_unique late_dup" }],
        labels: [],
        edges: [],
      },
    );

    const full = search(
      { persistence },
      {
        namespace: "ns",
        content: { text: "asof_marker_early_unique" },
        options: { arms: { lexical: 1, vector: 0 }, topK: 10 },
      },
    );
    expect(full.length).toBeGreaterThanOrEqual(2);

    const asOf = search(
      { persistence },
      {
        namespace: "ns",
        content: { text: "asof_marker_early_unique" },
        asOfTimestampMs: rowEarly.t,
        options: { arms: { lexical: 1, vector: 0 }, topK: 10 },
      },
    );
    expect(asOf.length).toBe(1);
    expect(asOf[0]?.memory.key).toBe("early");
  });

  test("throws when backend lacks asOfTimestampMsSearch capability", () => {
    const persistence = {
      capabilities: {
        lexicalSearch: true,
        vectorSearch: false,
        neighborIndex: false,
        graphIndex: false,
        multiNamespaceSearch: true,
        unscopedSearch: false,
      },
      searchLexicalSourceMapIds: () => [] as string[],
      searchVectorSourceMapIds: () => [] as string[],
      hydrateSourceMapHits: () => [],
    };
    expect(() =>
      search(
        { persistence: persistence as never },
        {
          namespace: "ns",
          content: { text: "x" },
          asOfTimestampMs: 1,
        },
      ),
    ).toThrow("asOfTimestampMsSearch");
  });
});
