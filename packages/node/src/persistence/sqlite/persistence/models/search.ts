import type { SQLQueryBindings } from "bun:sqlite";
import type { HydratedNeighbor, HydratedSourceMapHit } from "../../../../persistence/core";
import {
  canonicalizeNamespacePrefixes,
  ids,
  type NeighborConstraint,
  type NeighborFilter,
  type NeighborNodesFilter,
  namespacePath,
  namespacePrefixFieldForDepth,
  namespaceSegments,
  type OntologyLabelInstance,
  type SearchNamespaceScope,
} from "../../../../persistence/core";
import type { Edge, Memory } from "../../../../persistence/core/persistence";
import { vectorToBlob } from "../connection";
import { hasVectorAnnSearch, vectorVecTableName } from "../search-indexes";
import type { DbCtx } from "./context";
import { loadGraphEdge } from "./graph-index";

export type {
  HydratedNeighbor,
  HydratedSourceMapHit,
  NeighborConstraint,
  NeighborFilter,
  NeighborNodesFilter,
} from "../../../../persistence/core";

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function parseProperties(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

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

function matchesNodeLabelFilter(
  labels: readonly OntologyLabelInstance[],
  filter: NeighborNodesFilter<string> | undefined,
): boolean {
  const kinds = labels.map((l) => l.kind);
  if (!filter) return true;
  if (filter.all && !filter.all.every((label) => kinds.includes(label))) {
    return false;
  }
  if (
    filter.some &&
    filter.some.length > 0 &&
    !filter.some.some((label) => kinds.includes(label))
  ) {
    return false;
  }
  return true;
}

function neighborConstraintSatisfied<EDGE_LABEL extends string, NODE_LABEL extends string>(
  constraint: NeighborConstraint<EDGE_LABEL, NODE_LABEL>,
  edgeLabels: readonly OntologyLabelInstance[],
  direction: "in" | "out",
  neighborNodeLabels: readonly OntologyLabelInstance[],
): boolean {
  const kinds = edgeLabels.map((e) => e.kind);
  if (!kinds.includes(constraint.label as string)) return false;
  if (constraint.direction !== undefined && constraint.direction !== direction) return false;
  return matchesNodeLabelFilter(neighborNodeLabels, constraint.nodes);
}

/**
 * FTS5 MATCH string: AND-combines whitespace-separated tokens as phrase terms (quotes escaped).
 * Stemming/plural alignment comes from the FTS tokenizer (e.g. `porter` in {@link initTextFeaturesFts}), not the query.
 */
export function buildFtsMatchFromUserText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const clauses = tokens.map((raw) => {
    const tok = raw.replace(/"/g, '""');
    /** Phrase OR prefix so e.g. `Archer` can match Porter-stemmed `archery` in the index. */
    if (tok.length >= 3 && /^[\p{L}\p{N}]+$/u.test(raw)) {
      return `("${tok}" OR ${tok}*)`;
    }
    return `"${tok}"`;
  });
  return clauses.join(" AND ");
}

function namespaceSubtreeOrClauses(
  namespaces: readonly string[],
  tableAlias?: string,
): { sql: string; bindings: SQLQueryBindings[] } {
  const roots = canonicalizeNamespacePrefixes(namespaces.map((n) => namespacePath(n)));
  if (roots.length === 0) {
    return { sql: "1 = 0", bindings: [] };
  }
  const parts: string[] = [];
  const bindings: SQLQueryBindings[] = [];
  for (const root of roots) {
    const depth = namespaceSegments(root).length;
    const key = namespacePrefixFieldForDepth(depth);
    const col = tableAlias ? `${tableAlias}.${key}` : key;
    parts.push(`(${col} = ?)`);
    bindings.push(root);
  }
  return { sql: parts.join(" OR "), bindings };
}

function memoriesWhereClauseFromScope(
  scope: SearchNamespaceScope,
  memoryIds: string[] | undefined,
  asOfTimestampMs?: number,
): { sql: string; bindings: SQLQueryBindings[] } {
  const asOfClause = asOfTimestampMs !== undefined ? " AND _ts_created <= ?" : "";
  const asOfBind: SQLQueryBindings[] = asOfTimestampMs !== undefined ? [asOfTimestampMs] : [];

  const idClause = memoryIds === undefined ? "" : ` AND _id IN (${placeholders(memoryIds.length)})`;
  const idBindings: SQLQueryBindings[] = memoryIds === undefined ? [] : [...memoryIds];

  if (scope.kind === "unscoped") {
    return {
      sql: `1 = 1${idClause}${asOfClause}`,
      bindings: [...idBindings, ...asOfBind],
    };
  }

  if (scope.kind === "pathSubtree") {
    const ns = scope.namespaces;
    if (ns.length === 0) {
      return { sql: "1 = 0", bindings: [] };
    }
    const { sql: nsOr, bindings: nsBindings } = namespaceSubtreeOrClauses(ns);
    return {
      sql: `(${nsOr})${idClause}${asOfClause}`,
      bindings: [...nsBindings, ...idBindings, ...asOfBind],
    };
  }

  if (scope.kind === "exactScope") {
    const ss = scope.scopes.map((s) => namespacePath(s));
    if (ss.length === 0) {
      return { sql: "1 = 0", bindings: [] };
    }
    return {
      sql: `_id IN (
        SELECT memory_id FROM memory_scopes
        WHERE scope_id IN (${placeholders(ss.length)})
      )${idClause}${asOfClause}`,
      bindings: [...ss, ...idBindings, ...asOfBind],
    };
  }

  /** scopeDag */
  const roots = scope.roots.map((r) => namespacePath(r));
  if (roots.length === 0) {
    return { sql: "1 = 0", bindings: [] };
  }
  return {
    sql: `_id IN (
      SELECT DISTINCT ms.memory_id
      FROM memory_scopes ms
      INNER JOIN scope_closure c ON c.descendant_scope_id = ms.scope_id
      WHERE c.ancestor_scope_id IN (${placeholders(roots.length)})
    )${idClause}${asOfClause}`,
    bindings: [...roots, ...idBindings, ...asOfBind],
  };
}

function memoryIdSubqueryFromScope(
  scope: SearchNamespaceScope,
  memoryIds: string[] | undefined,
  asOfTimestampMs?: number,
): { sql: string; bindings: SQLQueryBindings[] } {
  const { sql: innerSql, bindings } = memoriesWhereClauseFromScope(
    scope,
    memoryIds,
    asOfTimestampMs,
  );
  return {
    sql: `memory_id IN (SELECT _id FROM memories WHERE ${innerSql})`,
    bindings,
  };
}

export function searchLexicalSourceMapIds(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    text: string;
    limit: number;
    memoryIds?: string[];
    asOfTimestampMs?: number;
  },
): string[] {
  if (input.text.length === 0) return [];
  if (input.memoryIds !== undefined && input.memoryIds.length === 0) return [];

  const matchExpr = buildFtsMatchFromUserText(input.text);
  if (matchExpr.length === 0) return [];

  const { sql: memFilter, bindings: memBindings } = memoryIdSubqueryFromScope(
    input.scope,
    input.memoryIds,
    input.asOfTimestampMs,
  );

  const params: SQLQueryBindings[] = [matchExpr, ...memBindings, input.limit];

  const rows = ctx.db
    .query<{ sourceMapId: string }, SQLQueryBindings[]>(
      `SELECT source_map_id AS sourceMapId
       FROM text_features_fts
       WHERE text_features_fts MATCH ?
         AND ${memFilter}
       ORDER BY bm25(text_features_fts)
       LIMIT ?`,
    )
    .all(...params);
  return rows.map((row) => row.sourceMapId);
}

export function searchVectorSourceMapIds(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    /** sqlite‑vec KNN distance; rows with larger distance are excluded. */
    maxVectorDistance?: number;
    asOfTimestampMs?: number;
    method: "knn" | "ann";
  },
): { sourceMapIds: string[]; vectorSearchMethod?: "knn" | "ann" } {
  if (input.method !== "knn" && input.method !== "ann") return { sourceMapIds: [] };
  if (input.method === "ann" && !hasVectorAnnSearch(ctx.db)) return { sourceMapIds: [] };
  if (input.memoryIds !== undefined && input.memoryIds.length === 0) return { sourceMapIds: [] };
  if (input.scope.kind === "pathSubtree" && input.scope.namespaces.length === 0)
    return { sourceMapIds: [] };
  if (input.scope.kind === "scopeDag" && input.scope.roots.length === 0)
    return { sourceMapIds: [] };
  if (input.scope.kind === "exactScope" && input.scope.scopes.length === 0)
    return { sourceMapIds: [] };

  const sourceMapIds =
    input.method === "ann" ? searchVectorAnn(ctx, input) : searchVectorKnn(ctx, input);
  return { sourceMapIds, vectorSearchMethod: input.method };
}

/** DiskANN vec0 MATCH path; scope and allowlist constraints are post-filters. */
function searchVectorAnn(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOfTimestampMs?: number;
  },
): string[] {
  const tableName = vectorVecTableName(input.vector.length);
  const exists = ctx.db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(tableName);
  if (!exists) return [];

  const maxD = input.maxVectorDistance;
  const applyExactDistance = maxD !== undefined && Number.isFinite(maxD);

  const { sql: memFilter, bindings: memBindings } = memoryIdSubqueryFromScope(
    input.scope,
    input.memoryIds,
    input.asOfTimestampMs,
  );

  const params: SQLQueryBindings[] = [JSON.stringify(input.vector), input.limit];
  if (applyExactDistance) {
    params.push(vectorToBlob(new Float32Array(input.vector)));
    params.push(maxD as number);
  }
  params.push(...memBindings);

  const rows = ctx.db
    .query<{ sourceMapId: string }, SQLQueryBindings[]>(
      `WITH knn AS (
         SELECT vector_feature_id, distance
         FROM "${tableName.replaceAll('"', '""')}"
         WHERE embedding MATCH ?
           AND k = ?
       )
       SELECT vf.source_map_id AS sourceMapId
       FROM knn
       JOIN vector_features vf ON vf._id = knn.vector_feature_id
       WHERE 1 = 1
       ${applyExactDistance ? "AND vec_distance_cosine(vf.vector, ?) <= ?" : ""}
       AND ${memFilter}
       ORDER BY knn.distance ASC`,
    )
    .all(...params);
  return rows.map((row) => row.sourceMapId);
}

/**
 * Scalar vec_distance_cosine path for scoped/allowlist searches.
 *
 * The scope filter is a WHERE predicate on `vector_features` evaluated before any distance
 * is computed. With the `idx_vector_features_memory_id` index the planner resolves the
 * in-scope memory ids first, then only scores those vectors — O(n_namespace) not O(n_total).
 *
 * The `length(vf.vector) = ?` predicate filters to the correct embedding dimension without
 * requiring a per-dimension shadow table lookup.
 */
function searchVectorKnn(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOfTimestampMs?: number;
  },
): string[] {
  const queryVec = vectorToBlob(new Float32Array(input.vector));
  const expectedByteLen = input.vector.length * Float32Array.BYTES_PER_ELEMENT;

  const { sql: memFilter, bindings: memBindings } = memoryIdSubqueryFromScope(
    input.scope,
    input.memoryIds,
    input.asOfTimestampMs,
  );

  const maxD = input.maxVectorDistance;
  const distClause = maxD !== undefined && Number.isFinite(maxD) ? "WHERE dist <= ?" : "";

  const params: SQLQueryBindings[] = [queryVec, expectedByteLen, ...memBindings];
  if (distClause) params.push(maxD as number);
  params.push(input.limit);

  const rows = ctx.db
    .query<{ sourceMapId: string }, SQLQueryBindings[]>(
      `WITH scoped AS (
         SELECT vf.source_map_id AS sourceMapId,
                vec_distance_cosine(vf.vector, ?) AS dist
         FROM vector_features vf
         WHERE length(vf.vector) = ?
           AND ${memFilter}
       )
       SELECT sourceMapId FROM scoped
       ${distClause}
       ORDER BY dist ASC
       LIMIT ?`,
    )
    .all(...params);
  return rows.map((row) => row.sourceMapId);
}

export function hydrateSourceMapHits(
  ctx: DbCtx,
  sourceMapIds: readonly string[],
): HydratedSourceMapHit[] {
  if (sourceMapIds.length === 0) return [];

  const sourceMapRows = ctx.db
    .query<
      {
        sourceMapId: string;
        sourceMapCreated: number;
        memoryId: string;
        sourceKey: string;
        memoryCreated: number;
        namespace: string;
        key: string;
        memoryKind: string | null;
        memoryEdgeId: string | null;
      },
      string[]
    >(
      `SELECT
         sm._id AS sourceMapId,
         sm._ts_created AS sourceMapCreated,
         sm.memory_id AS memoryId,
         sm.source_key AS sourceKey,
         m._ts_created AS memoryCreated,
         m.namespace AS namespace,
         m.key AS key,
         m.kind AS memoryKind,
         m.edge_id AS memoryEdgeId
       FROM source_maps sm
       JOIN memories m ON m._id = sm.memory_id
       WHERE sm._id IN (${placeholders(sourceMapIds.length)})`,
    )
    .all(...sourceMapIds);

  type HitRow = {
    _id: string;
    _ts_created: number;
    memory_id: string;
    source_key: string;
    memory: Memory;
    memoryKind: string;
    memoryEdgeId: string | null;
  };

  const bySourceMapId = new Map<string, HitRow>(
    sourceMapRows.map((row) => {
      const mk = row.memoryKind ?? "node";
      const mem: Memory = {
        _id: row.memoryId,
        _ts_created: row.memoryCreated,
        namespace: namespacePath(row.namespace),
        key: row.key,
        kind: mk === "edge" ? "edge" : "node",
        ...(mk === "edge" && row.memoryEdgeId ? { edge_id: row.memoryEdgeId } : {}),
      };
      return [
        row.sourceMapId,
        {
          _id: row.sourceMapId,
          _ts_created: row.sourceMapCreated,
          memory_id: row.memoryId,
          source_key: row.sourceKey,
          memory: mem,
          memoryKind: mk,
          memoryEdgeId: row.memoryEdgeId,
        },
      ];
    }),
  );

  const nodeIds = [
    ...new Set(
      sourceMapRows
        .filter((row) => (row.memoryKind ?? "node") !== "edge")
        .map((row) => ids.node(row.namespace, row.key)),
    ),
  ];
  const labelsByNodeId = new Map<string, OntologyLabelInstance[]>();
  if (nodeIds.length > 0) {
    const labelRows = ctx.db
      .query<{ nodeId: string; kind: string; propsJson: string | null }, string[]>(
        `SELECT nla.node_id AS nodeId, nl.kind AS kind, nla.props AS propsJson
         FROM node_label_assignments nla
         JOIN node_labels nl ON nl._id = nla.label_id
         WHERE nla.node_id IN (${placeholders(nodeIds.length)})
         ORDER BY nl.kind ASC`,
      )
      .all(...nodeIds);

    for (const { nodeId, kind, propsJson } of labelRows) {
      const labels = labelsByNodeId.get(nodeId) ?? [];
      labels.push({ kind, props: parsePropsColumn(propsJson) });
      labelsByNodeId.set(nodeId, labels);
    }
  }

  const edgeIds = [
    ...new Set(
      sourceMapRows
        .filter((row) => (row.memoryKind ?? "node") === "edge" && row.memoryEdgeId)
        .flatMap((row) => (row.memoryEdgeId ? [row.memoryEdgeId] : [])),
    ),
  ];
  const edgeLabelsByEdgeId = new Map<string, OntologyLabelInstance[]>();
  if (edgeIds.length > 0) {
    const elRows = ctx.db
      .query<{ edgeId: string; kind: string; propsJson: string | null }, string[]>(
        `SELECT ela.edge_id AS edgeId, el.kind AS kind, ela.props AS propsJson
         FROM edge_label_assignments ela
         JOIN edge_labels el ON el._id = ela.label_id
         WHERE ela.edge_id IN (${placeholders(edgeIds.length)})
         ORDER BY el.kind ASC`,
      )
      .all(...edgeIds);
    for (const { edgeId, kind, propsJson } of elRows) {
      const ls = edgeLabelsByEdgeId.get(edgeId) ?? [];
      ls.push({ kind, props: parsePropsColumn(propsJson) });
      edgeLabelsByEdgeId.set(edgeId, ls);
    }
  }

  const graphEdgeByEdgeId = new Map<string, NonNullable<ReturnType<typeof loadGraphEdge>>>();
  for (const eid of edgeIds) {
    const ns = sourceMapRows.find((r) => r.memoryEdgeId === eid)?.namespace ?? "";
    const link = loadGraphEdge(ctx.db, ns, eid);
    if (link) graphEdgeByEdgeId.set(eid, link);
  }

  return sourceMapIds.flatMap((sourceMapId) => {
    const row = bySourceMapId.get(sourceMapId);
    if (!row) return [];
    const mk = row.memoryKind ?? "node";
    if (mk === "edge" && row.memoryEdgeId) {
      const edgeLink = graphEdgeByEdgeId.get(row.memoryEdgeId);
      return [
        {
          _id: row._id,
          _ts_created: row._ts_created,
          memory_id: row.memory_id,
          source_key: row.source_key,
          memory: row.memory,
          labels: edgeLabelsByEdgeId.get(row.memoryEdgeId) ?? [],
          graph: edgeLink ? { kind: "edge" as const, edge: edgeLink } : { kind: "node" as const },
        },
      ];
    }
    const nodeId = ids.node(row.memory.namespace, row.memory.key);
    return [
      {
        _id: row._id,
        _ts_created: row._ts_created,
        memory_id: row.memory_id,
        source_key: row.source_key,
        memory: row.memory,
        labels: labelsByNodeId.get(nodeId) ?? [],
        graph: { kind: "node" as const },
      },
    ];
  });
}

export function listNeighborsForMemory<
  EDGE_LABEL extends string = string,
  NODE_LABEL extends string = string,
>(
  ctx: DbCtx,
  input: {
    namespace: string;
    key: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  },
): HydratedNeighbor[] {
  const nodeId = ids.node(input.namespace, input.key);
  const rows = ctx.db
    .query<
      {
        edgeId: string;
        edgeCreated: number;
        fromNodeId: string;
        toNodeId: string;
        edgeProperties: unknown;
        edgeKind: string;
        edgeLabelPropsJson: string | null;
        memoryId: string;
        memoryCreated: number;
        namespace: string;
        key: string;
      },
      [string, string, string]
    >(
      `SELECT
         e._id AS edgeId,
         e._ts_created AS edgeCreated,
         e.from_node_id AS fromNodeId,
         e.to_node_id AS toNodeId,
         e.properties AS edgeProperties,
         el.kind AS edgeKind,
         ela.props AS edgeLabelPropsJson,
         m._id AS memoryId,
         m._ts_created AS memoryCreated,
         m.namespace AS namespace,
         m.key AS key
       FROM edges e
       JOIN edge_label_assignments ela ON ela.edge_id = e._id
       JOIN edge_labels el ON el._id = ela.label_id
       JOIN nodes n ON n._id = CASE
         WHEN e.from_node_id = ? THEN e.to_node_id
         ELSE e.from_node_id
       END
       JOIN memories m ON m._id = n.memory_id
       WHERE e.from_node_id = ? OR e.to_node_id = ?
       ORDER BY e._id ASC, el.kind ASC`,
    )
    .all(nodeId, nodeId, nodeId);

  const grouped = new Map<
    string,
    {
      memory: Memory;
      edge: Edge;
      direction: "in" | "out";
      edgeLabels: OntologyLabelInstance[];
    }
  >();

  for (const row of rows) {
    const inst: OntologyLabelInstance = {
      kind: row.edgeKind,
      props: parsePropsColumn(row.edgeLabelPropsJson),
    };
    const existing = grouped.get(row.edgeId);
    if (existing) {
      existing.edgeLabels.push(inst);
      continue;
    }
    grouped.set(row.edgeId, {
      memory: {
        _id: row.memoryId,
        _ts_created: row.memoryCreated,
        namespace: namespacePath(row.namespace),
        key: row.key,
        kind: "node",
      },
      edge: {
        _id: row.edgeId,
        _ts_created: row.edgeCreated,
        from_node_id: row.fromNodeId,
        to_node_id: row.toNodeId,
        properties: parseProperties(row.edgeProperties),
      },
      direction: row.fromNodeId === nodeId ? "out" : "in",
      edgeLabels: [inst],
    });
  }

  const neighborNodeIds = [
    ...new Set([...grouped.values()].map((v) => ids.node(v.memory.namespace, v.memory.key))),
  ];
  const neighborNodeLabelsById = new Map<string, OntologyLabelInstance[]>();
  if (neighborNodeIds.length > 0) {
    const labelRows = ctx.db
      .query<{ nodeId: string; kind: string; propsJson: string | null }, string[]>(
        `SELECT nla.node_id AS nodeId, nl.kind AS kind, nla.props AS propsJson
         FROM node_label_assignments nla
         JOIN node_labels nl ON nl._id = nla.label_id
         WHERE nla.node_id IN (${placeholders(neighborNodeIds.length)})
         ORDER BY nl.kind ASC`,
      )
      .all(...neighborNodeIds);
    for (const { nodeId, kind, propsJson } of labelRows) {
      const ls = neighborNodeLabelsById.get(nodeId) ?? [];
      ls.push({ kind, props: parsePropsColumn(propsJson) });
      neighborNodeLabelsById.set(nodeId, ls);
    }
  }

  return [...grouped.values()].flatMap((row) => {
    const edgeLabels = row.edgeLabels;
    const neighborNodeLabels =
      neighborNodeLabelsById.get(ids.node(row.memory.namespace, row.memory.key)) ?? [];

    const matches = (
      constraints: NeighborConstraint<EDGE_LABEL, NODE_LABEL>[] | undefined,
    ): OntologyLabelInstance[] => {
      if (!constraints || constraints.length === 0) return edgeLabels;
      return edgeLabels.filter((inst) =>
        constraints.some(
          (constraint) =>
            (constraint.label as string) === inst.kind &&
            neighborConstraintSatisfied(constraint, edgeLabels, row.direction, neighborNodeLabels),
        ),
      );
    };

    const allConstraints = input.filters?.all;
    if (
      allConstraints &&
      !allConstraints.every((constraint) =>
        neighborConstraintSatisfied(constraint, edgeLabels, row.direction, neighborNodeLabels),
      )
    ) {
      return [];
    }

    const someConstraints = input.filters?.some;
    if (
      someConstraints &&
      someConstraints.length > 0 &&
      !someConstraints.some((constraint) =>
        neighborConstraintSatisfied(constraint, edgeLabels, row.direction, neighborNodeLabels),
      )
    ) {
      return [];
    }

    const preferredLabel =
      matches(allConstraints)[0] ?? matches(someConstraints)[0] ?? edgeLabels[0];
    if (!preferredLabel) return [];

    return [
      {
        ...row.memory,
        labels: neighborNodeLabels,
        edge: {
          ...row.edge,
          label: preferredLabel,
        },
      },
    ];
  });
}

/** Both endpoint node memories for one graph edge, for neighbor sub-search from an edge memory root. */
export function listNeighborsForEdgeMemory<
  EDGE_LABEL extends string = string,
  NODE_LABEL extends string = string,
>(
  ctx: DbCtx,
  input: {
    namespace: string;
    edgeId: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  },
): HydratedNeighbor[] {
  const link = loadGraphEdge(ctx.db, input.namespace, input.edgeId);
  if (!link) return [];
  const fromN = listNeighborsForMemory<EDGE_LABEL, NODE_LABEL>(ctx, {
    namespace: input.namespace,
    key: link.fromKey,
    filters: input.filters,
  });
  const toN = listNeighborsForMemory<EDGE_LABEL, NODE_LABEL>(ctx, {
    namespace: input.namespace,
    key: link.toKey,
    filters: input.filters,
  });
  return [
    ...fromN.filter((n) => n.edge._id === input.edgeId),
    ...toN.filter((n) => n.edge._id === input.edgeId),
  ];
}
