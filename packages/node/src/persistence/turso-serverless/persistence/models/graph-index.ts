import type {
  GraphEdgeLink,
  GraphNode,
  IncludeSuppressedOpts,
  OntologyLabelInstance,
} from "../../../../persistence/core";
import { ids } from "../../../../persistence/core";
import type { DbCtx } from "../context";
import type { TursoDatabase } from "../db";
import { ctxQueryAll, readQueryAll } from "../db";
import { parsePropsColumn } from "../sql";
import { isNamespaceSuppressed } from "./namespace-suppress";

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

/** Edge visible in graph layout when neither endpoint/memory nor namespace is suppressed. */
const GRAPH_EDGE_NOT_SUPPRESSED = `
  AND mf.suppressed = 0 AND mt.suppressed = 0
  AND NOT EXISTS (
    SELECT 1 FROM memories me WHERE me.edge_id = e._id AND me.suppressed != 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM namespace_metadata nm
    WHERE nm.suppressed != 0
      AND (
        mf.namespace = nm._id OR mf.namespace LIKE nm._id || '/%'
        OR mt.namespace = nm._id OR mt.namespace LIKE nm._id || '/%'
      )
  )`;

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

export async function loadGraphEdgesForNamespace(
  db: TursoDatabase,
  namespace: string,
  opts?: IncludeSuppressedOpts,
): Promise<GraphEdgeLink[]> {
  const include = opts?.includeSuppressed === true;
  const nsSuppressed = await isNamespaceSuppressed(db, namespace);
  if (!include && nsSuppressed) return [];
  const filter = include ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  const rows = await readQueryAll<GraphEdgeQueryRow>(
    db,
    `${edgeSelectSql(include)}
     WHERE 1 = 1${filter}
     ORDER BY e._id ASC, el.kind ASC`,
    [namespace, namespace],
  );
  const links = graphEdgeLinksFromRows(rows, include);
  if (include && nsSuppressed) {
    return links.map((l) => (l.suppressed === true ? l : { ...l, suppressed: true }));
  }
  return links;
}

export async function listIncidentGraphEdgesForMemory(
  db: TursoDatabase,
  namespace: string,
  memoryKey: string,
  opts?: IncludeSuppressedOpts,
): Promise<GraphEdgeLink[]> {
  const include = opts?.includeSuppressed === true;
  const nsSuppressed = await isNamespaceSuppressed(db, namespace);
  if (!include && nsSuppressed) return [];
  const filter = include ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  const rows = await readQueryAll<GraphEdgeQueryRow>(
    db,
    `${edgeSelectSql(include)}
     WHERE (nf.value = ? OR nt.value = ?)${filter}
     ORDER BY e._id ASC, el.kind ASC`,
    [namespace, namespace, memoryKey, memoryKey],
  );
  const links = graphEdgeLinksFromRows(rows, include);
  if (include && nsSuppressed) {
    return links.map((l) => (l.suppressed === true ? l : { ...l, suppressed: true }));
  }
  return links;
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
  opts?: IncludeSuppressedOpts,
): Promise<GraphNode | null> {
  const mem = await readQueryAll<{ suppressed: number }>(
    db,
    `SELECT suppressed FROM memories WHERE namespace = ? AND key = ? LIMIT 1`,
    [namespace, memoryKey],
  );
  const first = mem[0];
  if (!first) return null;
  const nodeId = ids.node(namespace, memoryKey);
  const labels = await loadNodeLabelsForMemory(db, namespace, memoryKey);
  const properties = await loadNodePropertiesForMemory(db, namespace, memoryKey);
  const node: GraphNode = { namespace, memoryKey, nodeId, labels, properties };
  if (
    opts?.includeSuppressed === true &&
    (first.suppressed !== 0 || (await isNamespaceSuppressed(db, namespace)))
  ) {
    node.suppressed = true;
  }
  return node;
}

export async function loadGraphEdge(
  dbOrCtx: TursoDatabase | DbCtx,
  namespace: string,
  edgeId: string,
  opts?: IncludeSuppressedOpts,
): Promise<GraphEdgeLink | null> {
  const include = opts?.includeSuppressed === true;
  const db = "now" in dbOrCtx ? dbOrCtx.db : dbOrCtx;
  const nsSuppressed = await isNamespaceSuppressed(db, namespace);
  if (!include && nsSuppressed) return null;
  const filter = include ? "" : GRAPH_EDGE_NOT_SUPPRESSED;
  const sql = `${edgeSelectSql(include)}
     WHERE e._id = ?${filter}
     ORDER BY el.kind ASC`;
  const args = [namespace, namespace, edgeId];
  const rows =
    "now" in dbOrCtx
      ? await ctxQueryAll<GraphEdgeQueryRow>(dbOrCtx, sql, args)
      : await readQueryAll<GraphEdgeQueryRow>(dbOrCtx, sql, args);
  const link = graphEdgeLinksFromRows(rows, include)[0] ?? null;
  if (link && include && nsSuppressed && link.suppressed !== true) {
    return { ...link, suppressed: true };
  }
  return link;
}

function nodeKeysSql(includeSuppressed: boolean): string {
  return includeSuppressed
    ? `SELECT key FROM memories WHERE namespace = ? AND kind = 'node'`
    : `SELECT key FROM memories WHERE namespace = ? AND kind = 'node' AND suppressed = 0`;
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

export async function listSuppressedNodeKeysForNamespace(
  db: TursoDatabase,
  namespace: string,
): Promise<string[]> {
  const sql = (await isNamespaceSuppressed(db, namespace))
    ? `SELECT key FROM memories WHERE namespace = ? AND kind = 'node'`
    : `SELECT key FROM memories WHERE namespace = ? AND kind = 'node' AND suppressed != 0`;
  const rows = await readQueryAll<{ key: string }>(db, sql, [namespace]);
  return rows.map((r) => r.key);
}

export async function loadNodePropertiesForNamespace(
  db: TursoDatabase,
  namespace: string,
  opts?: IncludeSuppressedOpts,
): Promise<Map<string, Record<string, unknown> | null>> {
  const include = opts?.includeSuppressed === true;
  if (!include && (await isNamespaceSuppressed(db, namespace))) return new Map();
  const keys = await readQueryAll<{ key: string }>(db, nodeKeysSql(include), [namespace]);
  const map = new Map<string, Record<string, unknown> | null>();
  for (const { key } of keys) {
    map.set(key, null);
  }
  if (keys.length === 0) return map;

  const rows = await readQueryAll<{ memoryKey: string; propertiesJson: string | null }>(
    db,
    nodeRowsSql(include),
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
  opts?: IncludeSuppressedOpts,
): Promise<Map<string, OntologyLabelInstance[]>> {
  const include = opts?.includeSuppressed === true;
  if (!include && (await isNamespaceSuppressed(db, namespace))) return new Map();
  const keys = await readQueryAll<{ key: string }>(db, nodeKeysSql(include), [namespace]);
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
