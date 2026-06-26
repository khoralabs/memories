import type { OntologyLabelInstance } from "@khoralabs/memories-persistence-core";

export type GraphLayoutNode = {
  key: string;
  x: number;
  y: number;
  z: number;
  labels: OntologyLabelInstance[];
};

export type GraphLayoutEdge = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  labels: OntologyLabelInstance[];
  directed?: boolean;
};

export type NamespaceGraphLayout = {
  namespace: string;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
};
