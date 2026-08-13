import type { Database } from "bun:sqlite";
import type {
  GraphEdgeLink,
  GraphNamespaceCounts,
  GraphNamespaceStats,
  GraphNode,
  IncludeSuppressedOpts,
  OntologyLabelInstance,
} from "../../../../persistence/core";
import { ids } from "../../../../persistence/core";
import {
  foldKindCountRows,
  GRAPH_EDGE_NOT_SUPPRESSED,
  SQL_COUNT_SUPPRESSED_NODES,
  sqlCountDistinctEdges,
  sqlCountNodes,
  sqlEdgeLabelKindHistogram,
  sqlNodeKeys,
  sqlNodeLabelKindHistogram,
  suppressedEdgeCountFromTotals,
} from "../../../../persistence/core/models/graph-namespace-stats-sql";
import { isNamespaceSuppressed } from "./namespace-metadata";

function parsePropsColumn(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function directedFromEdgePropertiesJson(json: string | null): boolean {
  if (!json) return false;
  try {
    const p: unknown = JSON.parse(json);
    if (p && typeof p === "object" && !Array.isArray(p)) {
      return (p as { directed?: unknown }).directed === true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Parsed `edges.properties` JSON; `null` when absent or invalid. */
function parseEdgeRowProperties(json: string | null): Record<string, unknown> | null {
  if (json == null || json === "") return null;
  try {
    const p: unknown = JSON.parse(json);
    if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

const GRAPH_EDGE_SUPPRESSION_COLS = `,
              mf.suppressed AS fromSuppressed,
              mt.suppressed AS toSuppressed,
              EXISTS (
                SELECT 1 FROM memories me WHERE me.edge_id = e._id AND me.suppressed != 0
              ) AS edgeMemSuppressed`;

function finishGraphEdgeLink(
  edgeId: string,
  fromKey: string,
  toKey: string,
  labels: OntologyLabelInstance[],
  propertiesJson: string | null,
  suppressed?: boolean,
): GraphEdgeLink {
  const link: GraphEdgeLink = {
    edgeId,
    fromKey,
    toKey,
    labels,
  };
  const props = parseEdgeRowProperties(propertiesJson);
  if (props !== null) link.properties = props;
  if (directedFromEdgePropertiesJson(propertiesJson)) link.directed = true;
  if (suppressed === true) link.suppressed = true;
  return link;
}

type GraphEdgeQueryRow = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  propertiesJson: string | null;
  kind: string | null;
  propsJson: string | null;
  fromSuppressed?: number;
  toSuppressed?: number;
  edgeMemSuppressed?: number;
};

function graphEdgeLinksFromRows(
  rows: GraphEdgeQueryRow[],
  markSuppressed: boolean,
): GraphEdgeLink[] {
  const byEdge = new Map<
    string,
    {
      fromKey: string;
      toKey: string;
      propertiesJson: string | null;
      labels: OntologyLabelInstance[];
      suppressed: boolean;
    }
  >();

  for (const r of rows) {
    const existing = byEdge.get(r.edgeId);
    const label =
      r.kind != null
        ? ({ kind: r.kind, props: parsePropsColumn(r.propsJson) } satisfies OntologyLabelInstance)
        : null;
    const rowSuppressed =
      markSuppressed &&
      ((r.fromSuppressed ?? 0) !== 0 ||
        (r.toSuppressed ?? 0) !== 0 ||
        (r.edgeMemSuppressed ?? 0) !== 0);
    if (existing) {
      if (label) existing.labels.push(label);
      if (rowSuppressed) existing.suppressed = true;
      continue;
    }
    byEdge.set(r.edgeId, {
      fromKey: r.fromKey,
      toKey: r.toKey,
      propertiesJson: r.propertiesJson,
      labels: label ? [label] : [],
      suppressed: rowSuppressed,
    });
  }

  const out: GraphEdgeLink[] = [];
  for (const [edgeId, v] of byEdge) {
    out.push(
      finishGraphEdgeLink(
        edgeId,
        v.fromKey,
        v.toKey,
        v.labels,
        v.propertiesJson,
        markSuppressed ? v.suppressed : undefined,
      ),
    );
  }
  return out;
}

function edgeSelectSql(includeSuppressed: boolean): string {
  return `SELECT e._id AS edgeId, nf.value AS fromKey, nt.value AS toKey,
              e.properties AS propertiesJson,
              el.kind AS kind,
              ela.props AS propsJson${includeSuppressed ? GRAPH_EDGE_SUPPRESSION_COLS : ""}
       FROM edges e
       JOIN nodes nf ON nf._id = e.from_node_id
       JOIN nodes nt ON nt._id = e.to_node_id
       JOIN memories mf ON mf.namespace = ? AND mf.key = nf.value
       JOIN memories mt ON mt.namespace = ? AND mt.key = nt.value
       LEFT JOIN edge_label_assignments ela ON ela.edge_id = e._id
       LEFT JOIN edge_labels el ON el._id = ela.label_id`;
}

export function loadGraphEdgesForNamespace(
  db: Database,
  namespace: string,
  opts?: IncludeSuppressedOpts,
): GraphEdgeLink[] {
  const include = opts?.includeSuppressed === true;
  const nsSuppressed = isNamespaceSuppressed(db, namespace);
  if (!include && nsSuppressed) return [];
  const filter = include ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  const rows = db
    .query<GraphEdgeQueryRow, [string, string]>(
      `${edgeSelectSql(include)}
       WHERE 1 = 1${filter}
       ORDER BY e._id ASC, el.kind ASC`,
    )
    .all(namespace, namespace);

  const links = graphEdgeLinksFromRows(rows, include);
  if (include && nsSuppressed) {
    return links.map((l) => (l.suppressed === true ? l : { ...l, suppressed: true }));
  }
  return links;
}

/** Incident edges only (both endpoints in `namespace`, one endpoint matches `memoryKey`). */
export function listIncidentGraphEdgesForMemory(
  db: Database,
  namespace: string,
  memoryKey: string,
  opts?: IncludeSuppressedOpts,
): GraphEdgeLink[] {
  const include = opts?.includeSuppressed === true;
  const nsSuppressed = isNamespaceSuppressed(db, namespace);
  if (!include && nsSuppressed) return [];
  const filter = include ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  const rows = db
    .query<GraphEdgeQueryRow, [string, string, string, string]>(
      `${edgeSelectSql(include)}
       WHERE (nf.value = ? OR nt.value = ?)${filter}
       ORDER BY e._id ASC, el.kind ASC`,
    )
    .all(namespace, namespace, memoryKey, memoryKey);

  const links = graphEdgeLinksFromRows(rows, include);
  if (include && nsSuppressed) {
    return links.map((l) => (l.suppressed === true ? l : { ...l, suppressed: true }));
  }
  return links;
}

export function loadNodeLabelsForMemory(
  db: Database,
  namespace: string,
  memoryKey: string,
): OntologyLabelInstance[] {
  const nodeId = ids.node(namespace, memoryKey);
  const rows = db
    .query<{ kind: string; propsJson: string | null }, [string]>(
      `SELECT nl.kind AS kind, nla.props AS propsJson
       FROM node_label_assignments nla
       JOIN node_labels nl ON nl._id = nla.label_id
       WHERE nla.node_id = ?
       ORDER BY nl.kind ASC`,
    )
    .all(nodeId);
  return rows.map((r) => ({ kind: r.kind, props: parsePropsColumn(r.propsJson) }));
}

export function loadNodePropertiesForMemory(
  db: Database,
  namespace: string,
  memoryKey: string,
): Record<string, unknown> | null {
  const row = db
    .query<{ propertiesJson: string | null }, [string, string]>(
      `SELECT n.properties AS propertiesJson
       FROM memories m
       LEFT JOIN nodes n ON n.value = m.key
       WHERE m.namespace = ? AND m.key = ?`,
    )
    .get(namespace, memoryKey);
  if (!row) return null;
  if (!row.propertiesJson) return null;
  try {
    const parsed: unknown = JSON.parse(row.propertiesJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Full graph node for one memory; `null` when no memory row exists for `memoryKey` in `namespace`. */
export function loadGraphNode(
  db: Database,
  namespace: string,
  memoryKey: string,
  opts?: IncludeSuppressedOpts,
): GraphNode | null {
  const mem = db
    .query<{ suppressed: number }, [string, string]>(
      `SELECT suppressed FROM memories WHERE namespace = ? AND key = ? LIMIT 1`,
    )
    .get(namespace, memoryKey);
  if (!mem) return null;
  const nodeId = ids.node(namespace, memoryKey);
  const labels = loadNodeLabelsForMemory(db, namespace, memoryKey);
  const properties = loadNodePropertiesForMemory(db, namespace, memoryKey);
  const node: GraphNode = { namespace, memoryKey, nodeId, labels, properties };
  if (
    opts?.includeSuppressed === true &&
    (mem.suppressed !== 0 || isNamespaceSuppressed(db, namespace))
  ) {
    node.suppressed = true;
  }
  return node;
}

export function loadGraphEdge(
  db: Database,
  namespace: string,
  edgeId: string,
  opts?: IncludeSuppressedOpts,
): GraphEdgeLink | null {
  const include = opts?.includeSuppressed === true;
  const nsSuppressed = isNamespaceSuppressed(db, namespace);
  if (!include && nsSuppressed) return null;
  const filter = include ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  const rows = db
    .query<GraphEdgeQueryRow, [string, string, string]>(
      `${edgeSelectSql(include)}
       WHERE e._id = ?${filter}
       ORDER BY el.kind ASC`,
    )
    .all(namespace, namespace, edgeId);

  const links = graphEdgeLinksFromRows(rows, include);
  const link = links[0] ?? null;
  if (link && include && nsSuppressed && link.suppressed !== true) {
    return { ...link, suppressed: true };
  }
  return link;
}

function nodeKeysSql(includeSuppressed: boolean): string {
  return sqlNodeKeys(includeSuppressed);
}

function nodeRowsSql(includeSuppressed: boolean): string {
  return includeSuppressed
    ? `SELECT m.key AS memoryKey, n.properties AS propertiesJson
       FROM memories m
       LEFT JOIN nodes n ON n.value = m.key
       WHERE m.namespace = ? AND m.kind = 'node'`
    : `SELECT m.key AS memoryKey, n.properties AS propertiesJson
       FROM memories m
       LEFT JOIN nodes n ON n.value = m.key
       WHERE m.namespace = ? AND m.kind = 'node' AND m.suppressed = 0`;
}

export function listSuppressedNodeKeysForNamespace(db: Database, namespace: string): string[] {
  if (isNamespaceSuppressed(db, namespace)) {
    return db
      .query<{ key: string }, [string]>(
        `SELECT key FROM memories WHERE namespace = ? AND kind = 'node'`,
      )
      .all(namespace)
      .map((r) => r.key);
  }
  return db
    .query<{ key: string }, [string]>(
      `SELECT key FROM memories WHERE namespace = ? AND kind = 'node' AND suppressed != 0`,
    )
    .all(namespace)
    .map((r) => r.key);
}

export function loadNodePropertiesForNamespace(
  db: Database,
  namespace: string,
  opts?: IncludeSuppressedOpts,
): Map<string, Record<string, unknown> | null> {
  const include = opts?.includeSuppressed === true;
  if (!include && isNamespaceSuppressed(db, namespace)) return new Map();
  const keys = db.query<{ key: string }, [string]>(nodeKeysSql(include)).all(namespace);
  const map = new Map<string, Record<string, unknown> | null>();
  for (const { key } of keys) {
    map.set(key, null);
  }
  if (keys.length === 0) return map;

  const rows = db
    .query<{ memoryKey: string; propertiesJson: string | null }, [string]>(nodeRowsSql(include))
    .all(namespace);

  for (const r of rows) {
    if (!r.propertiesJson) {
      map.set(r.memoryKey, null);
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(r.propertiesJson);
      map.set(
        r.memoryKey,
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null,
      );
    } catch {
      map.set(r.memoryKey, null);
    }
  }
  return map;
}

export function loadNodeLabelsForNamespace(
  db: Database,
  namespace: string,
  opts?: IncludeSuppressedOpts,
): Map<string, OntologyLabelInstance[]> {
  const include = opts?.includeSuppressed === true;
  if (!include && isNamespaceSuppressed(db, namespace)) return new Map();
  const keys = db.query<{ key: string }, [string]>(nodeKeysSql(include)).all(namespace);
  if (keys.length === 0) return new Map();
  const nodeIds = keys.map((k) => ids.node(namespace, k.key));
  const ph = nodeIds.map(() => "?").join(",");
  const rows = db
    .query<{ memoryKey: string; kind: string; propsJson: string | null }, string[]>(
      `SELECT n.value AS memoryKey, nl.kind AS kind, nla.props AS propsJson
       FROM node_label_assignments nla
       JOIN node_labels nl ON nl._id = nla.label_id
       JOIN nodes n ON n._id = nla.node_id
       WHERE nla.node_id IN (${ph})`,
    )
    .all(...nodeIds);

  const map = new Map<string, OntologyLabelInstance[]>();
  for (const { key } of keys) {
    map.set(key, []);
  }
  for (const r of rows) {
    const arr = map.get(r.memoryKey);
    if (arr) {
      arr.push({ kind: r.kind, props: parsePropsColumn(r.propsJson) });
    }
  }
  for (const k of [...map.keys()]) {
    const arr = map.get(k);
    if (arr && arr.length > 0) {
      arr.sort((a, b) => a.kind.localeCompare(b.kind));
    }
  }
  return map;
}

function countDistinctEdges(db: Database, namespace: string, includeSuppressed: boolean): number {
  const nsSuppressed = isNamespaceSuppressed(db, namespace);
  if (!includeSuppressed && nsSuppressed) return 0;
  const row = db
    .query<{ c: number }, [string, string]>(sqlCountDistinctEdges(includeSuppressed))
    .get(namespace, namespace);
  return row?.c ?? 0;
}

function countNodes(db: Database, namespace: string, includeSuppressed: boolean): number {
  if (!includeSuppressed && isNamespaceSuppressed(db, namespace)) return 0;
  const row = db.query<{ c: number }, [string]>(sqlCountNodes(includeSuppressed)).get(namespace);
  return row?.c ?? 0;
}

function countSuppressedNodes(db: Database, namespace: string): number {
  if (isNamespaceSuppressed(db, namespace)) {
    return countNodes(db, namespace, true);
  }
  const row = db.query<{ c: number }, [string]>(SQL_COUNT_SUPPRESSED_NODES).get(namespace);
  return row?.c ?? 0;
}

function countSuppressedEdges(db: Database, namespace: string): number {
  const all = countDistinctEdges(db, namespace, true);
  if (isNamespaceSuppressed(db, namespace)) return all;
  const visible = countDistinctEdges(db, namespace, false);
  return suppressedEdgeCountFromTotals(all, visible);
}

function nodeLabelKindHistogram(
  db: Database,
  namespace: string,
  includeSuppressed: boolean,
): Record<string, number> {
  if (!includeSuppressed && isNamespaceSuppressed(db, namespace)) return {};
  const keys = db.query<{ key: string }, [string]>(sqlNodeKeys(includeSuppressed)).all(namespace);
  if (keys.length === 0) return {};
  const nodeIds = keys.map((k) => ids.node(namespace, k.key));
  const ph = nodeIds.map(() => "?").join(",");
  const rows = db
    .query<{ kind: string; c: number }, string[]>(sqlNodeLabelKindHistogram(ph))
    .all(...nodeIds);
  return foldKindCountRows(rows);
}

function edgeLabelKindHistogram(
  db: Database,
  namespace: string,
  includeSuppressed: boolean,
): Record<string, number> {
  const nsSuppressed = isNamespaceSuppressed(db, namespace);
  if (!includeSuppressed && nsSuppressed) return {};
  const rows = db
    .query<{ kind: string; c: number }, [string, string]>(
      sqlEdgeLabelKindHistogram(includeSuppressed),
    )
    .all(namespace, namespace);
  return foldKindCountRows(rows);
}

export function countGraphForNamespace(
  db: Database,
  namespace: string,
  opts?: IncludeSuppressedOpts,
): GraphNamespaceCounts {
  const include = opts?.includeSuppressed === true;
  return {
    nodeCount: countNodes(db, namespace, include),
    edgeCount: countDistinctEdges(db, namespace, include),
  };
}

export function statsGraphForNamespace(
  db: Database,
  namespace: string,
  opts?: IncludeSuppressedOpts,
): GraphNamespaceStats {
  const include = opts?.includeSuppressed === true;
  const counts = countGraphForNamespace(db, namespace, opts);
  return {
    ...counts,
    suppressedNodeCount: countSuppressedNodes(db, namespace),
    suppressedEdgeCount: countSuppressedEdges(db, namespace),
    labelKinds: {
      nodes: nodeLabelKindHistogram(db, namespace, include),
      edges: edgeLabelKindHistogram(db, namespace, include),
    },
  };
}
