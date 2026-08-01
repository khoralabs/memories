import type { OntologyLabelInstance } from "../../persistence/core";

export type GraphLayoutNodeDegree = {
  /** Undirected incident-edge count within this layout. */
  count: number;
  /** `count / maxCount` in `[0, 1]` within this layout (`0` when max is 0). */
  centrality: number;
};

export type GraphLayoutNode = {
  key: string;
  x: number;
  y: number;
  z: number;
  labels: OntologyLabelInstance[];
  degree: GraphLayoutNodeDegree;
  /** Present when layout was built with `includeSuppressed: true`. */
  suppressed?: boolean;
};

export type GraphLayoutEdge = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  labels: OntologyLabelInstance[];
  directed?: boolean;
  /** Present when collected/laid out with `includeSuppressed: true`. */
  suppressed?: boolean;
};

export type NamespaceGraphLayout = {
  namespace: string;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
};
