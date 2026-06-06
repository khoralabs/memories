import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-core";
import { Output } from "ai";
import z from "zod";

/** Sorted ontology label kind strings (stable for schema + parsing). */
export function integratorLabelKindsFromOntology<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(ontology: OntologyDefinition<TNode, TEdge>): { node: string[]; edge: string[] } {
  return {
    node: Object.keys(ontology.nodeLabels).sort(),
    edge: Object.keys(ontology.edgeLabels).sort(),
  };
}

/**
 * Node labels as a **single object**: one optional field per ontology kind (payload = that kind's schema).
 * Avoids discriminated unions, which are brittle for provider structured output.
 */
function zNodeLabelsObjectFromOntology<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
): z.ZodType {
  const kinds = integratorLabelKindsFromOntology(ontology).node;
  const schemas = ontology.nodeLabels as unknown as Record<string, z.ZodType>;
  if (kinds.length === 0) {
    return z.object({}).describe("No node label kinds in this ontology — use an empty object {}.");
  }
  const shape: Record<string, z.ZodType> = {};
  for (const k of kinds) {
    const s = schemas[k];
    if (s === undefined) {
      throw new RangeError(`Ontology missing schema for node label kind: ${k}`);
    }
    shape[k] = s
      .optional()
      .describe(`Optional payload when this memory carries a "${k}" label (ontology fields).`);
  }
  return z
    .object(shape)
    .describe(
      "Node labels: only include keys you need; each key is an ontology kind name; value matches that kind's fields.",
    );
}

/**
 * One edge row: `memory` + `direction` + exactly one optional field matching an ontology edge kind (payload = that kind's schema).
 * Same pattern as node labels; no `kind` + loose `data` union.
 */
function zIntegratorEdgeItemKeyed<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
): z.ZodType {
  const edgeKinds = integratorLabelKindsFromOntology(ontology).edge;
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
        `Set this field (and only this among edge kinds) when the link is a "${k}" edge; value matches that kind's fields.`,
      );
  }

  const base = z.object({
    memory: z
      .string()
      .describe("Existing memory key (memory_search or host context; do not invent)."),
    direction: z
      .enum(["in", "out"])
      .describe(
        'Relative to the focal memory row: "out" = focal → neighbor; "in" = neighbor → focal.',
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
      return n === 1;
    },
    {
      message:
        "Exactly one ontology edge kind field must be set on each edge row (besides memory, direction, and optional properties).",
    },
  );
}

/** Wire format for LLM JSON: flat node label object + keyed edge rows. */
export function zIntegratorPlanWire<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
) {
  const { edge } = integratorLabelKindsFromOntology(ontology);

  const nodeLabelsSchema = zNodeLabelsObjectFromOntology(ontology);

  const edgesSchema =
    edge.length === 0
      ? z.array(z.never()).describe("No edge label kinds — must be empty [].")
      : z
          .array(zIntegratorEdgeItemKeyed(ontology))
          .describe(
            "Edges to existing neighbor memory keys; each item sets exactly one edge kind payload.",
          );

  return z.object({
    nodeLabels: nodeLabelsSchema,
    edges: edgesSchema,
    properties: z.record(z.string(), z.unknown()).optional().describe("Optional node/memory JSON."),
  });
}

/** Key = ontology node kind, value = payload (after parse). */
export type IntegratorNodeLabelsWire = Record<string, unknown>;

/**
 * One edge row: required `memory` / `direction`, optional `properties`, and exactly one key among ontology edge kinds (validated by {@link zIntegratorPlanWire}).
 */
export type IntegratorEdgeWire = {
  memory: string;
  direction: "in" | "out";
  properties?: Record<string, unknown>;
} & Record<string, unknown>;

/** Parsed integrator structured output before mapping to merge. */
export type IntegratorPlanWire = {
  nodeLabels: IntegratorNodeLabelsWire;
  edges: IntegratorEdgeWire[];
  properties?: Record<string, unknown>;
};

export function integratorPlanOutputFromOntology<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(ontology: OntologyDefinition<TNode, TEdge>) {
  return Output.object({
    name: "MemoryIntegratorPlan",
    description:
      "MemoryIntegratorPlan: nodeLabels is an object with optional keys per ontology node kind; each edge row sets memory, direction, and exactly one optional field named for an ontology edge kind (that field's value is the payload).",
    schema: zIntegratorPlanWire(ontology),
  });
}

export type IntegratorPlanStructuredOutput = ReturnType<typeof integratorPlanOutputFromOntology>;

export function parseIntegratorPlanWire<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  data: unknown,
): IntegratorPlanWire {
  return zIntegratorPlanWire(ontology).parse(data) as IntegratorPlanWire;
}
