import { sqlNamespaceEqualsOrUnderPrefixCol } from "./like-escape";

/** Edge visible in graph layout when neither endpoint/memory nor namespace is suppressed. */
export const GRAPH_EDGE_NOT_SUPPRESSED = `
  AND mf.suppressed = 0 AND mt.suppressed = 0
  AND NOT EXISTS (
    SELECT 1 FROM memories me WHERE me.edge_id = e._id AND me.suppressed != 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM namespace_metadata nm
    WHERE nm.suppressed != 0
      AND (
        ${sqlNamespaceEqualsOrUnderPrefixCol("mf.namespace", "nm._id")}
        OR ${sqlNamespaceEqualsOrUnderPrefixCol("mt.namespace", "nm._id")}
      )
  )`;

export function sqlCountDistinctEdges(includeSuppressed: boolean): string {
  const filter = includeSuppressed ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  return `SELECT COUNT(DISTINCT e._id) AS c
       FROM edges e
       JOIN nodes nf ON nf._id = e.from_node_id
       JOIN nodes nt ON nt._id = e.to_node_id
       JOIN memories mf ON mf.namespace = ? AND mf.key = nf.value
       JOIN memories mt ON mt.namespace = ? AND mt.key = nt.value
       WHERE 1 = 1${filter}`;
}

export function sqlCountNodes(includeSuppressed: boolean): string {
  return includeSuppressed
    ? `SELECT COUNT(*) AS c FROM memories WHERE namespace = ? AND kind = 'node'`
    : `SELECT COUNT(*) AS c FROM memories WHERE namespace = ? AND kind = 'node' AND suppressed = 0`;
}

export const SQL_COUNT_SUPPRESSED_NODES = `SELECT COUNT(*) AS c FROM memories WHERE namespace = ? AND kind = 'node' AND suppressed != 0`;

export function sqlNodeKeys(includeSuppressed: boolean): string {
  return includeSuppressed
    ? `SELECT key FROM memories WHERE namespace = ? AND kind = 'node'`
    : `SELECT key FROM memories WHERE namespace = ? AND kind = 'node' AND suppressed = 0`;
}

export function sqlNodeLabelKindHistogram(placeholders: string): string {
  return `SELECT nl.kind AS kind, COUNT(*) AS c
       FROM node_label_assignments nla
       JOIN node_labels nl ON nl._id = nla.label_id
       WHERE nla.node_id IN (${placeholders})
       GROUP BY nl.kind`;
}

export function sqlEdgeLabelKindHistogram(includeSuppressed: boolean): string {
  const filter = includeSuppressed ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  return `SELECT el.kind AS kind, COUNT(DISTINCT e._id) AS c
       FROM edges e
       JOIN nodes nf ON nf._id = e.from_node_id
       JOIN nodes nt ON nt._id = e.to_node_id
       JOIN memories mf ON mf.namespace = ? AND mf.key = nf.value
       JOIN memories mt ON mt.namespace = ? AND mt.key = nt.value
       JOIN edge_label_assignments ela ON ela.edge_id = e._id
       JOIN edge_labels el ON el._id = ela.label_id
       WHERE 1 = 1${filter}
       GROUP BY el.kind`;
}

export type KindCountRow = { kind: string; c: number };

export function foldKindCountRows(rows: readonly KindCountRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = r.c;
  return out;
}

export function suppressedEdgeCountFromTotals(all: number, visible: number): number {
  return Math.max(0, all - visible);
}
