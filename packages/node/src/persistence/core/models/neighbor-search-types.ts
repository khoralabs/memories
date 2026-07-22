import type { Edge, GraphEdgeLink, Memory, SourceMapRow } from "../persistence";
import type { OntologyLabelInstance } from "./ontology-label";

/** Where hybrid search hit content attaches in the graph (primary node vs single edge). */
export type MemoryGraphAssociation = { kind: "node" } | { kind: "edge"; edge: GraphEdgeLink };

/** Same semantics as root hit `labels` filter: `all` = AND, `some` = OR (non-empty). Omitted = any. */
export type NeighborNodesFilter<NODE_LABEL extends string = string> = {
  all?: NODE_LABEL[];
  some?: NODE_LABEL[];
};

/** Omitted `direction` matches both incident orientations (in and out). */
export type NeighborConstraint<
  EDGE_LABEL extends string = string,
  NODE_LABEL extends string = string,
> = {
  label: EDGE_LABEL;
  direction?: "in" | "out";
  /** If set, the adjacent memory's node must satisfy these node-label rules. */
  nodes?: NeighborNodesFilter<NODE_LABEL>;
};

export type NeighborFilter<
  EDGE_LABEL extends string = string,
  NODE_LABEL extends string = string,
> = {
  all?: NeighborConstraint<EDGE_LABEL, NODE_LABEL>[];
  some?: NeighborConstraint<EDGE_LABEL, NODE_LABEL>[];
};

export type HydratedSourceMapHit = SourceMapRow & {
  memory: Memory;
  /** Node labels for `memory.kind === "node"`; edge label instances for `memory.kind === "edge"`. */
  labels: OntologyLabelInstance[];
  graph: MemoryGraphAssociation;
};

export type HydratedNeighbor = Memory & {
  /** Ontology node labels on the neighbor memory's node (same meaning as root hit `labels`). */
  labels: OntologyLabelInstance[];
  edge: Edge & { label: OntologyLabelInstance };
};
