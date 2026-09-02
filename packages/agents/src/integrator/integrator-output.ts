import type { LabelSchemaMap, OntologyDefinition } from "@khoralabs/memories-node/ontology";
import z from "zod";
import { zFlatJsonProperties } from "../flat-json-properties.js";

/**
 * Options for bounding the structured-output schema.
 * Large ontologies should pass kind allowlists (or a reduced ontology) rather than the full catalog.
 */
export type IntegratorPlanWireOptions = {
  allowedMemoryKeys?: readonly string[];
  /** When set, only these ontology node kinds appear in the wire schema (intersection with ontology). */
  allowedNodeKinds?: readonly string[];
  /** When set, only these ontology edge kinds appear in the wire schema (intersection with ontology). */
  allowedEdgeKinds?: readonly string[];
};

function intersectSortedKinds(all: readonly string[], allowed?: readonly string[]): string[] {
  if (allowed === undefined) return [...all];
  const allow = new Set(allowed);
  return all.filter((k) => allow.has(k));
}

/** Sorted ontology label kind strings (stable for schema + parsing). */
export function integratorLabelKindsFromOntology<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  ontology: OntologyDefinition<TNode, TEdge>,
  options?: Pick<IntegratorPlanWireOptions, "allowedNodeKinds" | "allowedEdgeKinds">,
): { node: string[]; edge: string[] } {
  return {
    node: intersectSortedKinds(Object.keys(ontology.nodeLabels).sort(), options?.allowedNodeKinds),
    edge: intersectSortedKinds(Object.keys(ontology.edgeLabels).sort(), options?.allowedEdgeKinds),
  };
}

/**
 * Node labels as a **single object**: one optional field per ontology kind (payload = that kind's schema).
 * Avoids discriminated unions, which are brittle for provider structured output.
 */
function zNodeLabelsObjectFromOntology<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  options?: IntegratorPlanWireOptions,
): z.ZodType {
  const kinds = integratorLabelKindsFromOntology(ontology, options).node;
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
    .strict()
    .describe(
      "Node labels: only include keys you need; each key is an ontology kind name; value matches that kind's fields.",
    );
}

function zIntegratorEdgeMemoryKey(options?: IntegratorPlanWireOptions): z.ZodType<string> {
  const allowed = options?.allowedMemoryKeys;
  if (allowed === undefined) {
    return z
      .string()
      .describe("Existing memory key (memory_search or host context; do not invent).");
  }
  if (allowed.length === 0) {
    return z.never().describe("No neighbor keys were discovered — edges must be empty.");
  }
  const sorted = [...allowed].sort((a, b) => a.localeCompare(b));
  return z
    .enum(sorted as [string, ...string[]])
    .describe("Neighbor memory key from memory_search results (exact match required).");
}

/**
 * One edge row: `memory` + `direction` + exactly one optional field matching an ontology edge kind (payload = that kind's schema).
 * Same pattern as node labels; no `kind` + loose `data` union.
 */
function zIntegratorEdgeItemKeyed<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  options?: IntegratorPlanWireOptions,
): z.ZodType {
  const edgeKinds = integratorLabelKindsFromOntology(ontology, options).edge;
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

  const base = z
    .object({
      memory: zIntegratorEdgeMemoryKey(options),
      direction: z
        .enum(["in", "out"])
        .describe(
          'Relative to the focal memory row: "out" = focal → neighbor; "in" = neighbor → focal.',
        ),
      ...shape,
      properties: zFlatJsonProperties(
        "Optional flat edge JSON (string/number/boolean/null values).",
      ),
    })
    .strict();

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
  options?: IntegratorPlanWireOptions,
) {
  const { edge } = integratorLabelKindsFromOntology(ontology, options);

  const nodeLabelsSchema = zNodeLabelsObjectFromOntology(ontology, options);

  const edgesSchema =
    edge.length === 0
      ? z.array(z.never()).describe("No edge label kinds — must be empty [].")
      : options?.allowedMemoryKeys !== undefined && options.allowedMemoryKeys.length === 0
        ? z.array(z.never()).describe("No neighbor keys discovered — edges must be empty [].")
        : z
            .array(zIntegratorEdgeItemKeyed(ontology, options))
            .describe(
              "Edges to existing neighbor memory keys; each item sets exactly one edge kind payload.",
            );

  return z.object({
    nodeLabels: nodeLabelsSchema,
    edges: edgesSchema,
    properties: zFlatJsonProperties(
      "Optional flat node/memory JSON (string/number/boolean/null values).",
    ),
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
  properties?: Record<string, string | number | boolean | null>;
} & Record<string, unknown>;

/** Parsed integrator structured output before mapping to merge. */
export type IntegratorPlanWire = {
  nodeLabels: IntegratorNodeLabelsWire;
  edges: IntegratorEdgeWire[];
  properties?: Record<string, string | number | boolean | null>;
};

export function parseIntegratorPlanWire<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  data: unknown,
  options?: IntegratorPlanWireOptions,
): IntegratorPlanWire {
  return zIntegratorPlanWire(ontology, options).parse(data) as IntegratorPlanWire;
}
