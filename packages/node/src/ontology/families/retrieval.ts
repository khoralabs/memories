import z from "zod";
import type { LabelPropsSearchFormatter } from "../label-props-search.ts";
import { defineOntology } from "../ontology.ts";
import { nl, s } from "./format-helpers.ts";

/** Edge kind for search-derived similarity between two memories. */
export const RETRIEVAL_SIMILARITY_EDGE_KIND = "retrieval_similarity" as const;

/** Node kind marking a memory used as a seed for retrieval expansion. */
export const RETRIEVAL_SEED_NODE_KIND = "retrieval_seed" as const;

/** JSON-stable snapshot of search tunables persisted on retrieval similarity edges. */
export const zRetrievalSearchConfig = z.record(z.string(), z.unknown());

export const zRetrievalSimilarityEdgeProps = z.object({
  similarityScore: z.number(),
  searchConfig: zRetrievalSearchConfig,
  rank: z.number().int().nonnegative().optional(),
  hitMemoryKey: z.string().optional(),
  hitSourceKey: z.string().optional(),
});

export const zRetrievalSeedNodeProps = z.object({
  source: z.literal("lexical_search"),
});

export const canonicalRetrievalNodeLabelShapes = {
  [RETRIEVAL_SEED_NODE_KIND]: zRetrievalSeedNodeProps,
} as const;

export const canonicalRetrievalEdgeLabelShapes = {
  [RETRIEVAL_SIMILARITY_EDGE_KIND]: zRetrievalSimilarityEdgeProps,
} as const;

/**
 * Ontology fragment for search-derived retrieval links.
 * Compose with an application ontology via `mergeOntologies` or object spread.
 */
export const retrievalSimilarityOntology = defineOntology({
  nodeLabels: canonicalRetrievalNodeLabelShapes,
  edgeLabels: canonicalRetrievalEdgeLabelShapes,
});

export type RetrievalSimilarityOntology = typeof retrievalSimilarityOntology;
export type RetrievalSimilarityNodeLabels = (typeof retrievalSimilarityOntology)["nodeLabels"];
export type RetrievalSimilarityEdgeLabels = (typeof retrievalSimilarityOntology)["edgeLabels"];

export const canonicalRetrievalLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
) => {
  if (role === "node") {
    if (kind !== RETRIEVAL_SEED_NODE_KIND) {
      return "";
    }
    return props.source ? `Retrieval seed source: ${s(props.source)}.` : "Retrieval seed.";
  }

  if (kind !== RETRIEVAL_SIMILARITY_EDGE_KIND) {
    return "";
  }
  return nl([
    `Retrieval similarity score: ${s(props.similarityScore)}.`,
    props.rank !== undefined ? `Retrieval rank: ${s(props.rank)}.` : "",
    props.hitMemoryKey ? `Hit memory key: ${s(props.hitMemoryKey)}.` : "",
    props.hitSourceKey ? `Hit source key: ${s(props.hitSourceKey)}.` : "",
  ]);
};
