import type { MergeMemoryParamsNode } from "@khoralabs/memories-core";
import type {
  EdgeLabelInstance,
  LabelSchemaMap,
  NodeLabelInstance,
  OntologyDefinition,
} from "@khoralabs/memories-ontologies";
import type z from "zod";
import type { IntegratorEdgeWire, IntegratorPlanWire } from "./integrator-output.js";
import { integratorLabelKindsFromOntology } from "./integrator-output.js";

function edgeKindAndPropsFromKeyedRow<TNode extends LabelSchemaMap, TEdge extends LabelSchemaMap>(
  ontology: OntologyDefinition<TNode, TEdge>,
  row: IntegratorEdgeWire,
): { kind: string; props: unknown } {
  const edgeKinds = integratorLabelKindsFromOntology(ontology).edge;
  const r = row as Record<string, unknown>;
  let found: { kind: string; props: unknown } | undefined;
  for (const k of edgeKinds) {
    const raw = r[k];
    if (raw === undefined) continue;
    const schema = ontology.edgeLabels[k as keyof TEdge];
    if (schema === undefined) {
      throw new RangeError(`Unknown edge label kind: ${k}`);
    }
    const props = (schema as unknown as z.ZodType).parse(raw);
    if (found !== undefined) {
      throw new RangeError(
        `Edge row has multiple edge kind payloads: ${found.kind} and ${k} (expected exactly one).`,
      );
    }
    found = { kind: k, props };
  }
  if (found === undefined) {
    throw new RangeError(
      "Edge row has no edge kind payload (expected exactly one ontology edge field).",
    );
  }
  return found;
}

/**
 * Maps integrator wire to {@link MemoriesClient.mergeMemory} slice (`props` / `peer_memory_id`).
 * Node labels: object keys are kinds; each edge row carries exactly one keyed payload among ontology edge kinds.
 */
export function integratorWireToMergeSlice<
  TNode extends LabelSchemaMap,
  TEdge extends LabelSchemaMap,
>(
  ontology: OntologyDefinition<TNode, TEdge>,
  wire: IntegratorPlanWire,
): Pick<MergeMemoryParamsNode<TNode, TEdge>, "labels" | "edges" | "properties"> {
  const labels: NodeLabelInstance<TNode>[] = [];
  const nl = wire.nodeLabels as Record<string, unknown>;
  for (const key of Object.keys(nl).sort()) {
    const v = nl[key];
    if (v === undefined) continue;
    const schema = ontology.nodeLabels[key as keyof TNode];
    if (schema === undefined) continue;
    const props = (schema as unknown as z.ZodType).parse(v);
    labels.push({ kind: key, props } as NodeLabelInstance<TNode>);
  }

  const edges: NonNullable<MergeMemoryParamsNode<TNode, TEdge>["edges"]> = wire.edges.map((e) => {
    const { kind, props } = edgeKindAndPropsFromKeyedRow(ontology, e);
    const label = { kind, props } as EdgeLabelInstance<TEdge>;
    return {
      peer_memory_id: e.memory,
      direction: e.direction,
      label,
      properties: e.properties,
    };
  });

  return {
    labels,
    edges: edges.length > 0 ? edges : undefined,
    properties: wire.properties,
  };
}
