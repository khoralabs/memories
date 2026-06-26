import { describe, expect, test } from "bun:test";
import { RETRIEVAL_SIMILARITY_EDGE_KIND } from "./retrieval";
import {
  canonicalSalienceLabelPropsSearchFormatter,
  MEMORY_NODE_KIND,
  RELATED_MEMORY_EDGE_KIND,
  salienceMemoryOntology,
  salienceRetrievalMemoryOntology,
  zMemoryNodeProps,
  zRelatedMemoryEdgeProps,
  zSalienceFacet,
} from "./salience";

describe("salience ontology family", () => {
  test("defines generic memory and related edge labels", () => {
    expect(salienceMemoryOntology.nodeLabels[MEMORY_NODE_KIND]).toBe(zMemoryNodeProps);
    expect(salienceMemoryOntology.edgeLabels[RELATED_MEMORY_EDGE_KIND]).toBe(
      zRelatedMemoryEdgeProps,
    );
  });

  test("validates salience facets", () => {
    const result = zSalienceFacet.parse({
      aspect: "constraint",
      statement: "Deploys must avoid user-visible downtime.",
    });
    expect(result).toEqual({
      aspect: "constraint",
      statement: "Deploys must avoid user-visible downtime.",
    });
  });

  test("composes with retrieval similarity ontology", () => {
    expect(salienceRetrievalMemoryOntology.nodeLabels).toHaveProperty(MEMORY_NODE_KIND);
    expect(salienceRetrievalMemoryOntology.edgeLabels).toHaveProperty(RELATED_MEMORY_EDGE_KIND);
    expect(salienceRetrievalMemoryOntology.edgeLabels).toHaveProperty(
      RETRIEVAL_SIMILARITY_EDGE_KIND,
    );
  });

  test("formats salience labels", () => {
    expect(
      canonicalSalienceLabelPropsSearchFormatter(MEMORY_NODE_KIND, "node", {
        features: [{ aspect: "claim", statement: "The cache is stale." }],
      }),
    ).toBe("Memory.\nclaim: The cache is stale.");
    expect(
      canonicalSalienceLabelPropsSearchFormatter(RELATED_MEMORY_EDGE_KIND, "edge", {
        context: "Both memories describe the same deployment risk",
      }),
    ).toBe("Related memory context: Both memories describe the same deployment risk.");
  });
});
