import z from "zod";
import type { LabelPropsSearchFormatter } from "../label-props-search.ts";
import { mergeOntologies } from "../merge-ontologies.ts";
import { defineOntology } from "../ontology.ts";
import { nl, s } from "./format-helpers.ts";
import { retrievalSimilarityOntology } from "./retrieval.ts";

/** A compressible slice of high information density from prose. */
export const zSalienceFacet = z.object({
  aspect: z
    .string()
    .max(64)
    .describe(
      "Short facet name for the dimension (e.g. timeline, stakeholder, constraint, preference, claim).",
    ),
  statement: z
    .string()
    .max(500)
    .describe(
      "Information-dense statement for this facet; readable without the surrounding prose.",
    ),
});

export type SalienceFacet = z.infer<typeof zSalienceFacet>;

export const MEMORY_NODE_KIND = "memory" as const;
export const RELATED_MEMORY_EDGE_KIND = "related" as const;

export const zMemoryNodeProps = z.object({
  features: z
    .array(zSalienceFacet)
    .max(12)
    .optional()
    .describe("Salience facets extracted from the memory prose."),
});

export const zRelatedMemoryEdgeProps = z.object({
  context: z.string().describe("Natural-language description of why these memories are linked."),
  features: z
    .array(zSalienceFacet)
    .max(6)
    .optional()
    .describe("Salience facets describing the relationship itself."),
});

export const canonicalSalienceNodeLabelShapes = {
  [MEMORY_NODE_KIND]: zMemoryNodeProps,
} as const;

export const canonicalSalienceEdgeLabelShapes = {
  [RELATED_MEMORY_EDGE_KIND]: zRelatedMemoryEdgeProps,
} as const;

/** Ontology fragment for homogeneous memories with salience facets and semantic related edges. */
export const salienceMemoryOntology = defineOntology({
  nodeLabels: canonicalSalienceNodeLabelShapes,
  edgeLabels: canonicalSalienceEdgeLabelShapes,
});

/** Salience memory ontology plus search-derived retrieval similarity labels. */
export const salienceRetrievalMemoryOntology = mergeOntologies(
  salienceMemoryOntology,
  retrievalSimilarityOntology,
);

export type SalienceMemoryOntology = typeof salienceMemoryOntology;
export type SalienceRetrievalMemoryOntology = typeof salienceRetrievalMemoryOntology;
export type SalienceMemoryNodeLabels = (typeof salienceMemoryOntology)["nodeLabels"];
export type SalienceMemoryEdgeLabels = (typeof salienceMemoryOntology)["edgeLabels"];

function formatFeatures(features: unknown): string {
  if (!Array.isArray(features) || features.length === 0) {
    return "";
  }
  return features
    .map((feature) => {
      if (typeof feature !== "object" || feature === null) {
        return "";
      }
      const aspect = "aspect" in feature ? s(feature.aspect) : "";
      const statement = "statement" in feature ? s(feature.statement) : "";
      return aspect.length > 0 && statement.length > 0 ? `${aspect}: ${statement}` : "";
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

export const canonicalSalienceLabelPropsSearchFormatter: LabelPropsSearchFormatter = (
  kind,
  role,
  props,
) => {
  if (role === "node") {
    if (kind !== MEMORY_NODE_KIND) {
      return "";
    }
    return nl(["Memory.", formatFeatures(props.features)]);
  }

  if (kind !== RELATED_MEMORY_EDGE_KIND) {
    return "";
  }
  return nl([`Related memory context: ${s(props.context)}.`, formatFeatures(props.features)]);
};
