import type { OntologyLabelInstance } from "@khoralabs/memories-persistence-core";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";

export type { OntologyLabelInstance, StandardJSONSchemaV1, StandardSchemaV1 };

/**
 * Maps each **label kind** (discriminant) to a Standard Schema for that label's `props`.
 * Use an empty object schema when a label has no extra fields.
 */
export type LabelSchemaMap = Record<string, StandardSchemaV1>;

export type OntologyDefinition<
  TNode extends LabelSchemaMap = LabelSchemaMap,
  TEdge extends LabelSchemaMap = LabelSchemaMap,
> = {
  readonly nodeLabels: TNode;
  readonly edgeLabels: TEdge;
};

/** One node-label variant: `kind` keys `nodeLabels`; `props` validated by `nodeLabels[kind]`. */
export type NodeLabelInstance<TNode extends LabelSchemaMap> = {
  [K in keyof TNode]: {
    kind: K & string;
    props: StandardSchemaV1.InferOutput<TNode[K]>;
  };
}[keyof TNode];

/** One edge-label variant: `kind` keys `edgeLabels`; `props` validated by `edgeLabels[kind]`. */
export type EdgeLabelInstance<TEdge extends LabelSchemaMap> = {
  [K in keyof TEdge]: {
    kind: K & string;
    props: StandardSchemaV1.InferOutput<TEdge[K]>;
  };
}[keyof TEdge];

/** Runtime schemas (e.g. Zod 4.2+) may expose both `validate` and `jsonSchema` on `~standard`. */
type StandardPropsWithJson = StandardSchemaV1["~standard"] &
  Pick<StandardJSONSchemaV1["~standard"], "jsonSchema">;

function standardPropsWithJson(schema: StandardSchemaV1): StandardPropsWithJson | undefined {
  const std = schema["~standard"];
  if ("jsonSchema" in std) {
    return std as StandardPropsWithJson;
  }
  return undefined;
}

function validateLabelProps(schema: StandardSchemaV1, props: unknown): Record<string, unknown> {
  const result = schema["~standard"].validate(props);
  if (result instanceof Promise) {
    throw new RangeError(
      "Label props schema returned a Promise; async validation is not supported",
    );
  }
  if ("value" in result) {
    return result.value as Record<string, unknown>;
  }
  const message = result.issues.map((i) => i.message).join("; ");
  throw new RangeError(message);
}

export function validateNodeLabel<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  label: { kind: string; props: unknown },
): { kind: string; props: Record<string, unknown> } {
  const schema = ontology.nodeLabels[label.kind as keyof TNode];
  if (schema === undefined) {
    throw new RangeError(`Unknown node label kind: ${String(label.kind)}`);
  }
  const props = validateLabelProps(schema, label.props);
  return { kind: label.kind, props };
}

export function validateEdgeLabel<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  label: { kind: string; props: unknown },
): { kind: string; props: Record<string, unknown> } {
  const schema = ontology.edgeLabels[label.kind as keyof TEdge];
  if (schema === undefined) {
    throw new RangeError(`Unknown edge label kind: ${String(label.kind)}`);
  }
  const props = validateLabelProps(schema, label.props);
  return { kind: label.kind, props };
}

/** JSON Schema (Draft 2020-12) object for a label props schema, for catalog persistence. */
export function propsSchemaToJson(schema: StandardSchemaV1): Record<string, unknown> {
  const std = standardPropsWithJson(schema);
  if (std === undefined) {
    throw new Error(
      "Label props schema does not implement StandardJSONSchemaV1 (~standard.jsonSchema)",
    );
  }
  return std.jsonSchema.output({ target: "draft-2020-12" });
}

/** Returns the props schema for a node label kind, or `undefined` if unknown. */
export function nodeLabelPropsSchema<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  kind: string,
): StandardSchemaV1 | undefined {
  const s = ontology.nodeLabels[kind as keyof TNode];
  return s === undefined ? undefined : s;
}

/** Returns the props schema for an edge label kind, or `undefined` if unknown. */
export function edgeLabelPropsSchema<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  kind: string,
): StandardSchemaV1 | undefined {
  const s = ontology.edgeLabels[kind as keyof TEdge];
  return s === undefined ? undefined : s;
}

/**
 * Builds a typed ontology. Pass Standard Schema-compatible schemas per kind; empty objects use an empty object schema.
 */
export function defineOntology<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  def: OntologyDefinition<TNode, TEdge>,
): OntologyDefinition<TNode, TEdge> {
  return def;
}
