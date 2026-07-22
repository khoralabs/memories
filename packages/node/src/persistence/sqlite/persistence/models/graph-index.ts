import type { Database } from "bun:sqlite";
import type {
  GraphEdgeLink,
  GraphNode,
  OntologyLabelInstance,
} from "@khoralabs/memories-persistence-core";
import { ids } from "@khoralabs/memories-persistence-core";

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

function finishGraphEdgeLink(
  edgeId: string,
  fromKey: string,
  toKey: string,
  labels: OntologyLabelInstance[],
  propertiesJson: string | null,
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
  return link;
}

type GraphEdgeQueryRow = {
  edgeId: string;
  fromKey: string;
  toKey: string;
  propertiesJson: string | null;
  kind: string | null;
  propsJson: string | null;
};

function graphEdgeLinksFromRows(rows: GraphEdgeQueryRow[]): GraphEdgeLink[] {
  const byEdge = new Map<
    string,
    {
      fromKey: string;
      toKey: string;
      propertiesJson: string | null;
      labels: OntologyLabelInstance[];
    }
  >();

  for (const r of rows) {
    const existing = byEdge.get(r.edgeId);
    const label =
      r.kind != null
        ? ({ kind: r.kind, props: parsePropsColumn(r.propsJson) } satisfies OntologyLabelInstance)
        : null;
    if (existing) {
      if (label) existing.labels.push(label);
      continue;
    }
    byEdge.set(r.edgeId, {
      fromKey: r.fromKey,
      toKey: r.toKey,
      propertiesJson: r.propertiesJson,
      labels: label ? [label] : [],
    });
  }

  const out: GraphEdgeLink[] = [];
  for (const [edgeId, v] of byEdge) {
    out.push(finishGraphEdgeLink(edgeId, v.fromKey, v.toKey, v.labels, v.propertiesJson));
  }
  return out;
}

export function loadGraphEdgesForNamespace(db: Database, namespace: string): GraphEdgeLink[] {
  const rows = db
    .query<GraphEdgeQueryRow, [string, string]>(
      `SELECT e._id AS edgeId, nf.value AS fromKey, nt.value AS toKey,
              e.properties AS propertiesJson,
              el.kind AS kind,
              ela.props AS propsJson
       FROM edges e
       JOIN nodes nf ON nf._id = e.from_node_id
       JOIN nodes nt ON nt._id = e.to_node_id
       JOIN memories mf ON mf.namespace = ? AND mf.key = nf.value
       JOIN memories mt ON mt.namespace = ? AND mt.key = nt.value
       LEFT JOIN edge_label_assignments ela ON ela.edge_id = e._id
       LEFT JOIN edge_labels el ON el._id = ela.label_id
       ORDER BY e._id ASC, el.kind ASC`,
    )
    .all(namespace, namespace);

  return graphEdgeLinksFromRows(rows);
}

/** Incident edges only (both endpoints in `namespace`, one endpoint matches `memoryKey`). */
export function listIncidentGraphEdgesForMemory(
  db: Database,
  namespace: string,
  memoryKey: string,
): GraphEdgeLink[] {
  const rows = db
    .query<GraphEdgeQueryRow, [string, string, string, string]>(
      `SELECT e._id AS edgeId, nf.value AS fromKey, nt.value AS toKey,
              e.properties AS propertiesJson,
              el.kind AS kind,
              ela.props AS propsJson
       FROM edges e
       JOIN nodes nf ON nf._id = e.from_node_id
       JOIN nodes nt ON nt._id = e.to_node_id
       JOIN memories mf ON mf.namespace = ? AND mf.key = nf.value
       JOIN memories mt ON mt.namespace = ? AND mt.key = nt.value
       LEFT JOIN edge_label_assignments ela ON ela.edge_id = e._id
       LEFT JOIN edge_labels el ON el._id = ela.label_id
       WHERE nf.value = ? OR nt.value = ?
       ORDER BY e._id ASC, el.kind ASC`,
    )
    .all(namespace, namespace, memoryKey, memoryKey);

  return graphEdgeLinksFromRows(rows);
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
): GraphNode | null {
  const mem = db
    .query<{ one: number }, [string, string]>(
      `SELECT 1 AS one FROM memories WHERE namespace = ? AND key = ? LIMIT 1`,
    )
    .get(namespace, memoryKey);
  if (!mem) return null;
  const nodeId = ids.node(namespace, memoryKey);
  const labels = loadNodeLabelsForMemory(db, namespace, memoryKey);
  const properties = loadNodePropertiesForMemory(db, namespace, memoryKey);
  return { namespace, memoryKey, nodeId, labels, properties };
}

export function loadGraphEdge(
  db: Database,
  namespace: string,
  edgeId: string,
): GraphEdgeLink | null {
  const rows = db
    .query<GraphEdgeQueryRow, [string, string, string]>(
      `SELECT e._id AS edgeId, nf.value AS fromKey, nt.value AS toKey,
              e.properties AS propertiesJson,
              el.kind AS kind,
              ela.props AS propsJson
       FROM edges e
       JOIN nodes nf ON nf._id = e.from_node_id
       JOIN nodes nt ON nt._id = e.to_node_id
       JOIN memories mf ON mf.namespace = ? AND mf.key = nf.value
       JOIN memories mt ON mt.namespace = ? AND mt.key = nt.value
       LEFT JOIN edge_label_assignments ela ON ela.edge_id = e._id
       LEFT JOIN edge_labels el ON el._id = ela.label_id
       WHERE e._id = ?
       ORDER BY el.kind ASC`,
    )
    .all(namespace, namespace, edgeId);

  const links = graphEdgeLinksFromRows(rows);
  return links[0] ?? null;
}

export function loadNodePropertiesForNamespace(
  db: Database,
  namespace: string,
): Map<string, Record<string, unknown> | null> {
  const keys = db
    .query<{ key: string }, [string]>(`SELECT key FROM memories WHERE namespace = ?`)
    .all(namespace);
  const map = new Map<string, Record<string, unknown> | null>();
  for (const { key } of keys) {
    map.set(key, null);
  }
  if (keys.length === 0) return map;

  const rows = db
    .query<{ memoryKey: string; propertiesJson: string | null }, [string]>(
      `SELECT m.key AS memoryKey, n.properties AS propertiesJson
       FROM memories m
       LEFT JOIN nodes n ON n.value = m.key
       WHERE m.namespace = ?`,
    )
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
): Map<string, OntologyLabelInstance[]> {
  const keys = db
    .query<{ key: string }, [string]>(`SELECT key FROM memories WHERE namespace = ?`)
    .all(namespace);
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
