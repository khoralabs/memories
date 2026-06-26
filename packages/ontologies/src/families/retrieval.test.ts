import { describe, expect, test } from "bun:test";
import {
  canonicalRetrievalLabelPropsSearchFormatter,
  RETRIEVAL_SEED_NODE_KIND,
  RETRIEVAL_SIMILARITY_EDGE_KIND,
  retrievalSimilarityOntology,
  zRetrievalSeedNodeProps,
  zRetrievalSimilarityEdgeProps,
} from "./retrieval";

describe("retrieval ontology family", () => {
  test("defines neutral retrieval label kinds", () => {
    expect(retrievalSimilarityOntology.nodeLabels[RETRIEVAL_SEED_NODE_KIND]).toBe(
      zRetrievalSeedNodeProps,
    );
    expect(retrievalSimilarityOntology.edgeLabels[RETRIEVAL_SIMILARITY_EDGE_KIND]).toBe(
      zRetrievalSimilarityEdgeProps,
    );
  });

  test("formats retrieval label props", () => {
    expect(
      canonicalRetrievalLabelPropsSearchFormatter(RETRIEVAL_SEED_NODE_KIND, "node", {
        source: "lexical_search",
      }),
    ).toBe("Retrieval seed source: lexical_search.");
    expect(
      canonicalRetrievalLabelPropsSearchFormatter(RETRIEVAL_SIMILARITY_EDGE_KIND, "edge", {
        similarityScore: 0.9,
        rank: 1,
      }),
    ).toBe("Retrieval similarity score: 0.9.\nRetrieval rank: 1.");
  });
});
