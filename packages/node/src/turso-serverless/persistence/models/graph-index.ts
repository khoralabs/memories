import type {
  GraphEdgeLink,
  GraphNode,
  OntologyLabelInstance,
} from "@khoralabs/memories-persistence-core";
import { ids } from "@khoralabs/memories-persistence-core";
import type { TursoDatabase } from "../db";
import { readQueryAll } from "../db";
import { parsePropsColumn } from "../sql";

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

export async function loadGraphEdgesForNamespace(
  db: TursoDatabase,
  namespace: string,
): Promise<GraphEdgeLink[]> {
  const rows = await readQueryAll<GraphEdgeQueryRow>(
    db,
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
    [namespace, namespace],
  );
  return graphEdgeLinksFromRows(rows);
}

export async function listIncidentGraphEdgesForMemory(
  db: TursoDatabase,
  namespace: string,
  memoryKey: string,
): Promise<GraphEdgeLink[]> {
  const rows = await readQueryAll<GraphEdgeQueryRow>(
    db,
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
    [namespace, namespace, memoryKey, memoryKey],
  );
  return graphEdgeLinksFromRows(rows);
}

export async function loadNodeLabelsForMemory(
  db: TursoDatabase,
  namespace: string,
  memoryKey: string,
): Promise<OntologyLabelInstance[]> {
  const nodeId = ids.node(namespace, memoryKey);
  const rows = await readQueryAll<{ kind: string; propsJson: string | null }>(
    db,
    `SELECT nl.kind AS kind, nla.props AS propsJson
     FROM node_label_assignments nla
     JOIN node_labels nl ON nl._id = nla.label_id
     WHERE nla.node_id = ?
     ORDER BY nl.kind ASC`,
    [nodeId],
  );
  return rows.map((r) => ({ kind: r.kind, props: parsePropsColumn(r.propsJson) }));
}

export async function loadNodePropertiesForMemory(
  db: TursoDatabase,
  namespace: string,
  memoryKey: string,
): Promise<Record<string, unknown> | null> {
  const row = await readQueryAll<{ propertiesJson: string | null }>(
    db,
    `SELECT n.properties AS propertiesJson
     FROM memories m
     LEFT JOIN nodes n ON n.value = m.key
     WHERE m.namespace = ? AND m.key = ?`,
    [namespace, memoryKey],
  );
  const first = row[0];
  if (!first) return null;
  if (!first.propertiesJson) return null;
  try {
    const parsed: unknown = JSON.parse(first.propertiesJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function loadGraphNode(
  db: TursoDatabase,
  namespace: string,
  memoryKey: string,
): Promise<GraphNode | null> {
  const mem = await readQueryAll<{ one: number }>(
    db,
    `SELECT 1 AS one FROM memories WHERE namespace = ? AND key = ? LIMIT 1`,
    [namespace, memoryKey],
  );
  if (mem.length === 0) return null;
  const nodeId = ids.node(namespace, memoryKey);
  const labels = await loadNodeLabelsForMemory(db, namespace, memoryKey);
  const properties = await loadNodePropertiesForMemory(db, namespace, memoryKey);
  return { namespace, memoryKey, nodeId, labels, properties };
}

export async function loadGraphEdge(
  db: TursoDatabase,
  namespace: string,
  edgeId: string,
): Promise<GraphEdgeLink | null> {
  const rows = await readQueryAll<GraphEdgeQueryRow>(
    db,
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
    [namespace, namespace, edgeId],
  );
  return graphEdgeLinksFromRows(rows)[0] ?? null;
}

export async function loadNodePropertiesForNamespace(
  db: TursoDatabase,
  namespace: string,
): Promise<Map<string, Record<string, unknown> | null>> {
  const keys = await readQueryAll<{ key: string }>(
    db,
    `SELECT key FROM memories WHERE namespace = ?`,
    [namespace],
  );
  const map = new Map<string, Record<string, unknown> | null>();
  for (const { key } of keys) {
    map.set(key, null);
  }
  if (keys.length === 0) return map;

  const rows = await readQueryAll<{ memoryKey: string; propertiesJson: string | null }>(
    db,
    `SELECT m.key AS memoryKey, n.properties AS propertiesJson
     FROM memories m
     LEFT JOIN nodes n ON n.value = m.key
     WHERE m.namespace = ?`,
    [namespace],
  );

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

export async function loadNodeLabelsForNamespace(
  db: TursoDatabase,
  namespace: string,
): Promise<Map<string, OntologyLabelInstance[]>> {
  const keys = await readQueryAll<{ key: string }>(
    db,
    `SELECT key FROM memories WHERE namespace = ?`,
    [namespace],
  );
  if (keys.length === 0) return new Map();
  const nodeIds = keys.map((k) => ids.node(namespace, k.key));
  const ph = nodeIds.map(() => "?").join(",");
  const rows = await readQueryAll<{ memoryKey: string; kind: string; propsJson: string | null }>(
    db,
    `SELECT n.value AS memoryKey, nl.kind AS kind, nla.props AS propsJson
     FROM node_label_assignments nla
     JOIN node_labels nl ON nl._id = nla.label_id
     JOIN nodes n ON n._id = nla.node_id
     WHERE nla.node_id IN (${ph})`,
    nodeIds,
  );

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
