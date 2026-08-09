import type { HydratedNeighbor, HydratedSourceMapHit } from "../../../../persistence/core";
import {
  ids,
  type NeighborConstraint,
  type NeighborFilter,
  type NeighborNodesFilter,
  namespacePath,
  type OntologyLabelInstance,
  type SearchAsOf,
  type SearchNamespaceScope,
} from "../../../../persistence/core";
import type { Edge, Memory } from "../../../../persistence/core/persistence";
import type { DbCtx } from "../context";
import { ctxQueryAll } from "../db";
import {
  buildFtsMatchFromUserText,
  memoryIdSubqueryFromScope,
  parsePropsColumn,
  placeholders,
  vector32Json,
  vectorByteLength,
} from "../sql";
import { loadGraphEdge } from "./graph-index";

export type {
  HydratedNeighbor,
  HydratedSourceMapHit,
  NeighborConstraint,
  NeighborFilter,
  NeighborNodesFilter,
} from "../../../../persistence/core";

export { buildFtsMatchFromUserText };

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

export async function searchLexicalSourceMapIds(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    text: string;
    limit: number;
    memoryIds?: string[];
    asOf?: SearchAsOf;
    includeSuppressed?: boolean;
  },
): Promise<string[]> {
  if (input.text.length === 0) return [];
  if (input.memoryIds !== undefined && input.memoryIds.length === 0) return [];

  const matchExpr = buildFtsMatchFromUserText(input.text);
  if (matchExpr.length === 0) return [];

  const { sql: memFilter, bindings: memBindings } = memoryIdSubqueryFromScope(
    input.scope,
    input.memoryIds,
    input.asOf,
    "tf",
    input.includeSuppressed,
  );

  const params: unknown[] = [matchExpr, ...memBindings, matchExpr, input.limit];

  const rows = await ctxQueryAll<{ sourceMapId: string }>(
    ctx,
    `SELECT tf.source_map_id AS sourceMapId
     FROM text_features tf
     WHERE fts_match(tf.text, ?)
       AND ${memFilter}
     ORDER BY fts_score(tf.text, ?) DESC
     LIMIT ?`,
    params,
  );
  return rows.map((row) => row.sourceMapId);
}

export async function searchVectorSourceMapIds(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOf?: SearchAsOf;
    method: "knn" | "ann";
    includeSuppressed?: boolean;
  },
): Promise<{ sourceMapIds: string[]; vectorSearchMethod?: "knn" | "ann" }> {
  if (input.memoryIds !== undefined && input.memoryIds.length === 0) return { sourceMapIds: [] };
  if (input.scope.kind === "pathSubtree" && input.scope.namespaces.length === 0)
    return { sourceMapIds: [] };
  if (input.scope.kind === "scopeDag" && input.scope.roots.length === 0)
    return { sourceMapIds: [] };
  if (input.scope.kind === "exactScope" && input.scope.scopes.length === 0)
    return { sourceMapIds: [] };

  if (input.method === "knn") {
    return { sourceMapIds: await searchVectorScoped(ctx, input), vectorSearchMethod: "knn" };
  }
  if (input.method === "ann") {
    return { sourceMapIds: await searchVectorAnn(ctx, input), vectorSearchMethod: "ann" };
  }
  return { sourceMapIds: [] };
}

async function searchVectorScoped(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOf?: SearchAsOf;
    includeSuppressed?: boolean;
  },
): Promise<string[]> {
  const vectorJson = vector32Json(input.vector);
  const expectedByteLen = vectorByteLength(input.vector.length);

  const { sql: memFilter, bindings: memBindings } = memoryIdSubqueryFromScope(
    input.scope,
    input.memoryIds,
    input.asOf,
    "vf",
    input.includeSuppressed,
  );

  const maxD = input.maxVectorDistance;
  const distClause = maxD !== undefined && Number.isFinite(maxD) ? "WHERE dist <= ?" : "";

  const params: unknown[] = [vectorJson, expectedByteLen, ...memBindings];
  if (distClause) params.push(maxD as number);
  params.push(input.limit);

  const rows = await ctxQueryAll<{ sourceMapId: string }>(
    ctx,
    `WITH scoped AS (
       SELECT vf.source_map_id AS sourceMapId,
              vector_distance_cos(vf.vector, vector32(?)) AS dist
       FROM vector_features vf
       WHERE length(vf.vector) = ?
         AND ${memFilter}
     )
     SELECT sourceMapId FROM scoped
     ${distClause}
     ORDER BY dist ASC
     LIMIT ?`,
    params,
  );
  return rows.map((row) => row.sourceMapId);
}

async function searchVectorAnn(
  ctx: DbCtx,
  input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOf?: SearchAsOf;
    includeSuppressed?: boolean;
  },
): Promise<string[]> {
  const { sql: memFilter, bindings: memBindings } = memoryIdSubqueryFromScope(
    input.scope,
    input.memoryIds,
    input.asOf,
    "vf",
    input.includeSuppressed,
  );
  const maxD = input.maxVectorDistance;
  const distClause = maxD !== undefined && Number.isFinite(maxD) ? "AND top.distance <= ?" : "";
  const params: unknown[] = [vector32Json(input.vector), input.limit, ...memBindings];
  if (distClause) params.push(maxD as number);

  const rows = await ctxQueryAll<{ sourceMapId: string }>(
    ctx,
    `SELECT vf.source_map_id AS sourceMapId
     FROM vector_top_k('idx_vector_features_ann', vector32(?), ?) AS top
     JOIN vector_features vf ON vf.rowid = top.id
     WHERE ${memFilter}
       ${distClause}
     ORDER BY top.distance ASC`,
    params,
  );
  return rows.map((row) => row.sourceMapId);
}

export async function hydrateSourceMapHits(
  ctx: DbCtx,
  sourceMapIds: readonly string[],
): Promise<HydratedSourceMapHit[]> {
  if (sourceMapIds.length === 0) return [];

  const sourceMapRows = await ctxQueryAll<{
    sourceMapId: string;
    sourceMapCreated: number;
    memoryId: string;
    sourceKey: string;
    memoryCreated: number;
    namespace: string;
    key: string;
    memoryKind: string | null;
    memoryEdgeId: string | null;
    memorySuppressed: number | null;
  }>(
    ctx,
    `SELECT
       sm._id AS sourceMapId,
       sm._ts_created AS sourceMapCreated,
       sm.memory_id AS memoryId,
       sm.source_key AS sourceKey,
       m._ts_created AS memoryCreated,
       m.namespace AS namespace,
       m.key AS key,
       m.kind AS memoryKind,
       m.edge_id AS memoryEdgeId,
       m.suppressed AS memorySuppressed
     FROM source_maps sm
     JOIN memories m ON m._id = sm.memory_id
     WHERE sm._id IN (${placeholders(sourceMapIds.length)})`,
    [...sourceMapIds],
  );

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
        suppressed:
          row.memorySuppressed !== null && row.memorySuppressed !== 0 ? (1 as const) : (0 as const),
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
    const labelRows = await ctxQueryAll<{ nodeId: string; kind: string; propsJson: string | null }>(
      ctx,
      `SELECT nla.node_id AS nodeId, nl.kind AS kind, nla.props AS propsJson
       FROM node_label_assignments nla
       JOIN node_labels nl ON nl._id = nla.label_id
       WHERE nla.node_id IN (${placeholders(nodeIds.length)})
       ORDER BY nl.kind ASC`,
      [...nodeIds],
    );

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
    const elRows = await ctxQueryAll<{ edgeId: string; kind: string; propsJson: string | null }>(
      ctx,
      `SELECT ela.edge_id AS edgeId, el.kind AS kind, ela.props AS propsJson
       FROM edge_label_assignments ela
       JOIN edge_labels el ON el._id = ela.label_id
       WHERE ela.edge_id IN (${placeholders(edgeIds.length)})
       ORDER BY el.kind ASC`,
      [...edgeIds],
    );
    for (const { edgeId, kind, propsJson } of elRows) {
      const ls = edgeLabelsByEdgeId.get(edgeId) ?? [];
      ls.push({ kind, props: parsePropsColumn(propsJson) });
      edgeLabelsByEdgeId.set(edgeId, ls);
    }
  }

  const graphEdgeByEdgeId = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof loadGraphEdge>>>
  >();
  for (const eid of edgeIds) {
    const ns = sourceMapRows.find((r) => r.memoryEdgeId === eid)?.namespace ?? "";
    const link = await loadGraphEdge(ctx.db, ns, eid);
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

export async function listNeighborsForMemory<
  EDGE_LABEL extends string = string,
  NODE_LABEL extends string = string,
>(
  ctx: DbCtx,
  input: {
    namespace: string;
    key: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
    includeSuppressed?: boolean;
  },
): Promise<HydratedNeighbor[]> {
  const nodeId = ids.node(input.namespace, input.key);
  const include = input.includeSuppressed === true;
  const visibilitySql = include
    ? ""
    : `AND m.suppressed = 0
       AND NOT EXISTS (
         SELECT 1 FROM namespace_metadata nm
         WHERE nm.suppressed != 0
           AND (m.namespace = nm._id OR m.namespace LIKE nm._id || '/%')
       )
       AND NOT EXISTS (
         SELECT 1 FROM memories me WHERE me.edge_id = e._id AND me.suppressed != 0
       )`;
  const rows = await ctxQueryAll<{
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
    memorySuppressed: number | null;
  }>(
    ctx,
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
       m.key AS key,
       m.suppressed AS memorySuppressed
     FROM edges e
     JOIN edge_label_assignments ela ON ela.edge_id = e._id
     JOIN edge_labels el ON el._id = ela.label_id
     JOIN nodes n ON n._id = CASE
       WHEN e.from_node_id = ? THEN e.to_node_id
       ELSE e.from_node_id
     END
     JOIN memories m ON m._id = n.memory_id
     WHERE (e.from_node_id = ? OR e.to_node_id = ?)
       ${visibilitySql}
     ORDER BY e._id ASC, el.kind ASC`,
    [nodeId, nodeId, nodeId],
  );

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
        suppressed:
          row.memorySuppressed !== null && row.memorySuppressed !== 0 ? (1 as const) : (0 as const),
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
    const labelRows = await ctxQueryAll<{ nodeId: string; kind: string; propsJson: string | null }>(
      ctx,
      `SELECT nla.node_id AS nodeId, nl.kind AS kind, nla.props AS propsJson
       FROM node_label_assignments nla
       JOIN node_labels nl ON nl._id = nla.label_id
       WHERE nla.node_id IN (${placeholders(neighborNodeIds.length)})
       ORDER BY nl.kind ASC`,
      [...neighborNodeIds],
    );
    for (const { nodeId: nid, kind, propsJson } of labelRows) {
      const ls = neighborNodeLabelsById.get(nid) ?? [];
      ls.push({ kind, props: parsePropsColumn(propsJson) });
      neighborNodeLabelsById.set(nid, ls);
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

export async function listNeighborsForEdgeMemory<
  EDGE_LABEL extends string = string,
  NODE_LABEL extends string = string,
>(
  ctx: DbCtx,
  input: {
    namespace: string;
    edgeId: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  },
): Promise<HydratedNeighbor[]> {
  const link = await loadGraphEdge(ctx.db, input.namespace, input.edgeId);
  if (!link) return [];
  const fromN = await listNeighborsForMemory<EDGE_LABEL, NODE_LABEL>(ctx, {
    namespace: input.namespace,
    key: link.fromKey,
    filters: input.filters,
  });
  const toN = await listNeighborsForMemory<EDGE_LABEL, NODE_LABEL>(ctx, {
    namespace: input.namespace,
    key: link.toKey,
    filters: input.filters,
  });
  return [
    ...fromN.filter((n) => n.edge._id === input.edgeId),
    ...toN.filter((n) => n.edge._id === input.edgeId),
  ];
}
