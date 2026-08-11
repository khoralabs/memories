import { describe, expect, test } from "bun:test";
import { search } from "./api/search";

describe("search asOf capability gate", () => {
  test("throws when backend lacks asOfTimestampMsSearch capability", () => {
    const persistence = {
      capabilities: {
        lexicalSearch: true,
        vectorSearch: false,
        vectorKnnSearch: false,
        vectorAnnSearch: false,
        neighborIndex: false,
        graphIndex: false,
        multiNamespaceSearch: true,
        unscopedSearch: false,
      },
      searchLexicalSourceMapIds: () => [] as string[],
      searchVectorSourceMapIds: () => ({ sourceMapIds: [] }),
      hydrateSourceMapHits: () => [],
    };
    expect(() =>
      search(
        { persistence: persistence as never },
        {
          namespace: "ns",
          content: { text: "x" },
          asOf: { lte: 1 },
        },
      ),
    ).toThrow("asOfTimestampMsSearch");
  });
});
