import { describe, expect, test } from "bun:test";
import { mergeMemory } from "./api/merge-memory";
import { search } from "./api/search";
import type { MemoriesPersistence } from "./persistence/types";

describe("MemoriesBackendCapabilities", () => {
  test("merge rejects vector content when vectorSearch is false", () => {
    const persistence = {
      capabilities: {
        lexicalSearch: true,
        vectorSearch: false,
        neighborIndex: true,
        multiNamespaceSearch: true,
        unscopedSearch: false,
      },
    } as unknown as MemoriesPersistence;
    expect(() =>
      mergeMemory(
        { persistence },
        {
          key: "k",
          namespace: "ns",
          content: [{ key: "chunk", vector: [0.1, 0.2] }],
          labels: [],
        },
      ),
    ).toThrow(/vectorSearch is false/);
  });

  test("search does not call vector arm when vectorSearch is false (vector-only query)", () => {
    let vectorCalls = 0;
    const persistence = {
      capabilities: {
        lexicalSearch: true,
        vectorSearch: false,
        neighborIndex: false,
        multiNamespaceSearch: true,
        unscopedSearch: false,
      },
      searchVectorSourceMapIds() {
        vectorCalls++;
        return [];
      },
      searchLexicalSourceMapIds() {
        return [];
      },
      hydrateSourceMapHits() {
        return [];
      },
    } as unknown as MemoriesPersistence;
    const hits = search({ persistence }, { namespace: "ns", content: { vector: [1, 2, 3] } });
    expect(hits).toEqual([]);
    expect(vectorCalls).toBe(0);
  });
});
