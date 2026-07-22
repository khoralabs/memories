import { describe, expect, test } from "bun:test";
import type { MemoriesPersistence } from "../persistence/core/persistence";
import { mergeMemory } from "./api/merge-memory";
import { search } from "./api/search";

describe("MemoriesBackendCapabilities", () => {
  test("merge rejects vector content when vectorSearch is false", () => {
    const persistence = {
      capabilities: {
        lexicalSearch: true,
        vectorSearch: false,
        vectorKnnSearch: false,
        vectorAnnSearch: false,
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
        vectorKnnSearch: false,
        vectorAnnSearch: false,
        neighborIndex: false,
        multiNamespaceSearch: true,
        unscopedSearch: false,
      },
      searchVectorSourceMapIds() {
        vectorCalls++;
        return { sourceMapIds: [] };
      },
      searchLexicalSourceMapIds() {
        return [];
      },
      hydrateSourceMapHits() {
        return [];
      },
    } as unknown as MemoriesPersistence;
    const { hits } = search({ persistence }, { namespace: "ns", content: { vector: [1, 2, 3] } });
    expect(hits).toEqual([]);
    expect(vectorCalls).toBe(0);
  });

  test("vector method selection respects capabilities and reports the method", () => {
    const calls: string[] = [];
    const makePersistence = (vectorKnnSearch: boolean, vectorAnnSearch: boolean) =>
      ({
        capabilities: {
          lexicalSearch: false,
          vectorSearch: true,
          vectorKnnSearch,
          vectorAnnSearch,
          neighborIndex: false,
          multiNamespaceSearch: true,
          unscopedSearch: false,
        },
        searchVectorSourceMapIds(input: { method: "knn" | "ann" }) {
          calls.push(input.method);
          return { sourceMapIds: [], vectorSearchMethod: input.method };
        },
        searchLexicalSourceMapIds() {
          return [];
        },
        hydrateSourceMapHits() {
          return [];
        },
      }) as unknown as MemoriesPersistence;

    const unsupported = search(
      { persistence: makePersistence(false, true) },
      {
        namespace: "ns",
        content: { vector: [1, 2, 3] },
        options: { vectorSearchMethod: "knn" },
      },
    );
    expect(unsupported.hits).toEqual([]);
    expect(calls).toEqual([]);

    const ann = search(
      { persistence: makePersistence(true, true) },
      { namespace: "ns", content: { vector: [1, 2, 3] } },
    );
    expect(calls).toEqual(["ann"]);
    expect(ann.vectorSearchMethod).toBe("ann");

    calls.length = 0;
    const knn = search(
      { persistence: makePersistence(true, false) },
      { namespace: "ns", content: { vector: [1, 2, 3] } },
    );
    expect(calls).toEqual(["knn"]);
    expect(knn.vectorSearchMethod).toBe("knn");
  });
});
