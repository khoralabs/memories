import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-ontologies";
import { Output } from "ai";
import z from "zod";

function labelKindsFromOntology<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
): { node: string[]; edge: string[] } {
  return {
    node: Object.keys(ontology.nodeLabels).sort(),
    edge: Object.keys(ontology.edgeLabels).sort(),
  };
}

/** Optional keyed object: one optional field per ontology node kind (payload = that kind’s schema). */
function zNodeLabelHintsFromOntology<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
): z.ZodType {
  const kinds = labelKindsFromOntology(ontology).node;
  const schemas = ontology.nodeLabels as unknown as Record<string, z.ZodType>;
  if (kinds.length === 0) {
    return z.object({}).describe("No node label kinds — use {} or omit nodeLabelHints.");
  }
  const shape: Record<string, z.ZodType> = {};
  for (const k of kinds) {
    const s = schemas[k];
    if (s === undefined) {
      throw new RangeError(`Ontology missing schema for node label kind: ${k}`);
    }
    shape[k] = s
      .optional()
      .describe(`Optional hint for a "${k}" label (ontology fields). Omit if unknown.`);
  }
  return z
    .object(shape)
    .describe(
      "Optional hints for node labels on the memory row: only include keys you can justify; values match each ontology kind.",
    );
}

/**
 * One edge hint row: neighbor key + direction + at most one optional edge-kind payload (same keys as ontology edge labels).
 */
function zEdgeLabelHintRowFromOntology<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
): z.ZodType {
  const edgeKinds = labelKindsFromOntology(ontology).edge;
  if (edgeKinds.length === 0) {
    return z.never();
  }
  const schemas = ontology.edgeLabels as unknown as Record<string, z.ZodType>;
  const shape: Record<string, z.ZodType> = {};
  for (const k of edgeKinds) {
    const s = schemas[k];
    if (s === undefined) {
      throw new RangeError(`Ontology missing schema for edge label kind: ${k}`);
    }
    shape[k] = s
      .optional()
      .describe(
        `Optional hint for a "${k}" edge to this neighbor; value matches that kind’s fields. At most one edge kind per row.`,
      );
  }

  const base = z.object({
    memory: z
      .string()
      .describe("Neighbor memory key from memory_search or host context; do not invent."),
    direction: z
      .enum(["in", "out"])
      .describe(
        'Relative to the memory being written: "out" = this memory → neighbor; "in" = neighbor → this memory.',
      ),
    ...shape,
    properties: z.record(z.string(), z.unknown()).optional().describe("Optional edge JSON."),
  });

  return base.refine(
    (row) => {
      let n = 0;
      for (const k of edgeKinds) {
        if ((row as Record<string, unknown>)[k] !== undefined) n++;
      }
      return n <= 1;
    },
    {
      message:
        "At most one ontology edge kind payload per hint row (besides memory, direction, and optional properties).",
    },
  );
}

/**
 * Structured output for the adapter: plaintext, optional memory key hint, optional ontology-aware label hints.
 */
export function zExpandedMemoryWireFromOntology<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(ontology: OntologyDefinition<TNode, TEdge>) {
  const { edge } = labelKindsFromOntology(ontology);
  const nodeLabelHintsSchema = zNodeLabelHintsFromOntology(ontology);

  const shape: Record<string, z.ZodType> = {
    plaintext: z
      .string()
      .min(1)
      .describe(
        "Narrative text suitable for long-term memory: explicit facts, time, actors, and cross-domain relevance. Use paragraphs separated by blank lines.",
      ),
    memoryKeySuggestion: z
      .string()
      .optional()
      .describe(
        "Suggested memory key for this content when the domain implies a stable identifier; omit if unsure.",
      ),
    nodeLabelHints: nodeLabelHintsSchema
      .optional()
      .describe("Optional hints for node labels (keys = ontology node kinds)."),
  };

  if (edge.length > 0) {
    shape.edgeLabelHints = z
      .array(zEdgeLabelHintRowFromOntology(ontology))
      .optional()
      .describe(
        "Optional hints for edges to other memories; each row targets one neighbor key and at most one edge kind.",
      );
  }

  return z
    .object(shape)
    .describe(
      "Expanded memory wire: required plaintext; optional key suggestion and ontology-aware label hints for downstream merge.",
    );
}

export function memoryAdapterExpandedOutput<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(ontology: OntologyDefinition<TNode, TEdge>) {
  return Output.object({
    name: "ExpandedMemory",
    description:
      "Expanded domain content as plaintext plus optional memory key and ontology-aware node/edge label hints for ingestion.",
    schema: zExpandedMemoryWireFromOntology(ontology),
  });
}

export type MemoryAdapterStructuredOutput = ReturnType<typeof memoryAdapterExpandedOutput>;

/** Parsed expanded wire (ontology-specific keys inside hints are still `unknown` at the type level). */
export type ExpandedMemoryWire = {
  plaintext: string;
  memoryKeySuggestion?: string;
  nodeLabelHints?: Record<string, unknown>;
  edgeLabelHints?: Record<string, unknown>[];
};

type AdapterGenerationLike = {
  output: unknown;
  steps: { length: number };
  finishReason: string | undefined;
};

/**
 * Validates {@link zExpandedMemoryWireFromOntology} and enforces non-empty plaintext (session runner logic).
 */
export function parseAdapterGenerationToExpandedMemoryWire<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  ontology: OntologyDefinition<TNode, TEdge>,
  generation: AdapterGenerationLike,
): ExpandedMemoryWire {
  const wire = zExpandedMemoryWireFromOntology(ontology);
  const out = wire.safeParse(generation.output);
  if (!out.success) {
    throw new Error(
      `Memory adapter structured output failed validation (steps=${String(generation.steps.length)}, finishReason=${String(generation.finishReason)}): ${out.error.message}`,
    );
  }
  const v = out.data as ExpandedMemoryWire;
  if (!v.plaintext?.trim()) {
    throw new Error(
      `Memory adapter did not produce usable plaintext (steps=${String(generation.steps.length)}, finishReason=${String(generation.finishReason)})`,
    );
  }
  return { ...v, plaintext: v.plaintext.trim() };
}
