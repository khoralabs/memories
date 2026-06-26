import { sha256 } from "js-sha256";

/**
 * Deterministic string ids: SHA-256 over `prefix` and `parts` (NUL-separated), hex truncated to 24 chars.
 * Pure JS (`js-sha256`) so the same implementation runs in Node, Bun, browsers, and Convex.
 */
export function stableId(prefix: string, ...parts: string[]): string {
  const h = sha256([prefix, ...parts].join("\0"));
  return `${prefix}_${h.slice(0, 24)}`;
}

/** Deterministic primary keys for merge / upsert flows. */
export const ids = {
  memory: (namespace: string, key: string) => stableId("mem", namespace, key),
  node: (namespace: string, key: string) => stableId("node", namespace, key),
  sourceMap: (memoryId: string, sourceKey: string) => stableId("sm", memoryId, sourceKey),
  textFeature: (sourceMapId: string) => stableId("tf", sourceMapId),
  vectorFeature: (sourceMapId: string) => stableId("vf", sourceMapId),
  nodeLabel: (value: string) => stableId("nl", value),
  edgeLabel: (value: string) => stableId("el", value),
  nodeLabelAssignment: (nodeId: string, labelId: string) => stableId("nla", nodeId, labelId),
  edge: (
    fromNodeId: string,
    toNodeId: string,
    label: string,
    fromMemoryId: string,
    toMemoryId: string,
  ) => stableId("edge", fromNodeId, toNodeId, label, fromMemoryId, toMemoryId),
  edgeLabelAssignment: (edgeId: string, labelId: string) => stableId("ela", edgeId, labelId),
  /** Deterministic provenance row id from chain inputs (stable across retries). */
  provenance: (parentRootHex: string, canonicalEventJson: string) =>
    stableId("prov", parentRootHex, canonicalEventJson),
} as const;
