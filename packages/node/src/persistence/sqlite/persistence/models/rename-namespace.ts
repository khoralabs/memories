import type { Database } from "bun:sqlite";
import { ids, stableId } from "../../../../persistence/core";
import { blobToVector } from "../connection";
import {
  deleteVectorVecRowsForMemory,
  ensureVectorFeaturesVecTable,
  hasVectorAnnSearch,
  vectorVecTableName,
} from "../search-indexes";
import type { DbCtx } from "./context";

type MemoryRow = {
  _id: string;
  namespace: string;
  key: string;
  kind: string;
  edge_id: string | null;
  _ts_created: number;
};

type NodeRow = {
  _id: string;
  memory_id: string;
  value: string;
  properties: string | null;
  _ts_created: number;
};

type EdgeRow = {
  _id: string;
  from_node_id: string;
  to_node_id: string;
  properties: string | null;
  _ts_created: number;
};

/**
 * Rematerialize memories / nodes / edges / indexes / metadata for a namespace path rewrite.
 * Caller must run inside {@link MemoriesPersistence.withTransaction}.
 * Does not append provenance (caller does).
 *
 * Order keeps FK integrity (SQLite ignores `PRAGMA foreign_keys` changes inside a transaction):
 * nodes → edges → memories → dependents → delete olds → metadata.
 */
export function renameNamespacePaths(
  ctx: DbCtx,
  nsMap: ReadonlyMap<string, string>,
): { renamedMemories: number } {
  if (nsMap.size === 0) return { renamedMemories: 0 };

  const { db, now, stmts } = ctx;
  const sources = [...nsMap.keys()];
  const placeholders = sources.map(() => "?").join(", ");

  const memories = db
    .query<MemoryRow, string[]>(
      `SELECT _id, namespace, key, kind, edge_id, _ts_created FROM memories WHERE namespace IN (${placeholders})`,
    )
    .all(...sources);

  const memIdMap = new Map<string, string>();
  const nodeIdMap = new Map<string, string>();
  for (const m of memories) {
    const newNs = nsMap.get(m.namespace);
    if (newNs === undefined) continue;
    const newMemId = ids.memory(newNs, m.key);
    memIdMap.set(m._id, newMemId);
    if (m.kind !== "edge") {
      nodeIdMap.set(ids.node(m.namespace, m.key), ids.node(newNs, m.key));
    }
  }

  for (const newNs of new Set(nsMap.values())) {
    stmts.insertIgnoreScope.run(newNs, now);
  }

  // 1. New nodes (no FK to memories)
  for (const m of memories) {
    if (m.kind === "edge") continue;
    const oldNodeId = ids.node(m.namespace, m.key);
    const newNodeId = nodeIdMap.get(oldNodeId);
    const newMemId = memIdMap.get(m._id);
    if (newNodeId === undefined || newMemId === undefined || oldNodeId === newNodeId) continue;
    const node = db
      .query<NodeRow, [string]>(
        `SELECT _id, memory_id, value, properties, _ts_created FROM nodes WHERE _id = ?`,
      )
      .get(oldNodeId);
    if (node === null) continue;
    db.run(
      `INSERT INTO nodes (_id, _ts_created, memory_id, value, properties) VALUES (?, ?, ?, ?, ?)`,
      [newNodeId, node._ts_created, newMemId, node.value, node.properties],
    );
    const nlas = db
      .query<{ label_id: string; props: string; _ts_created: number }, [string]>(
        `SELECT label_id, props, _ts_created FROM node_label_assignments WHERE node_id = ?`,
      )
      .all(oldNodeId);
    for (const a of nlas) {
      const newAId = ids.nodeLabelAssignment(newNodeId, a.label_id);
      db.run(
        `INSERT INTO node_label_assignments (_id, _ts_created, node_id, label_id, props)
         VALUES (?, ?, ?, ?, ?)`,
        [newAId, a._ts_created, newNodeId, a.label_id, a.props],
      );
    }
  }

  // 2. Rematerialize edges (both endpoints must already exist as nodes)
  const edgeIdMap = rematerializeEdges(ctx, nodeIdMap, memIdMap);

  // 3. New memory rows
  for (const m of memories) {
    const newNs = nsMap.get(m.namespace);
    const newMemId = memIdMap.get(m._id);
    if (newNs === undefined || newMemId === undefined || m._id === newMemId) continue;
    let newEdgeId: string | null = null;
    if (m.kind === "edge" && m.edge_id) {
      newEdgeId = edgeIdMap.get(m.edge_id) ?? m.edge_id;
    }
    db.run(
      `INSERT INTO memories (_id, _ts_created, namespace, key, kind, edge_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newMemId, m._ts_created, newNs, m.key, m.kind, newEdgeId],
    );
    copyMemoryDependents(ctx, m._id, newMemId, nsMap);
  }

  // Edge memories outside rename set: remap edge_id
  for (const [oldEdgeId, newEdgeId] of edgeIdMap) {
    if (oldEdgeId === newEdgeId) continue;
    db.run(`UPDATE memories SET edge_id = ? WHERE edge_id = ?`, [newEdgeId, oldEdgeId]);
  }

  // 4. Delete olds (dependents → memories → edges → nodes)
  for (const m of memories) {
    const oldMemId = m._id;
    const newMemId = memIdMap.get(oldMemId);
    if (newMemId === undefined || oldMemId === newMemId) continue;
    deleteMemoryDependents(db, ctx, oldMemId);
    stmts.deleteMemoryById.run(oldMemId);
  }

  for (const [oldEdgeId, newEdgeId] of edgeIdMap) {
    if (oldEdgeId === newEdgeId) continue;
    stmts.deleteEdgeLabelAssignmentsByEdgeId.run(oldEdgeId);
    stmts.deleteEdgeById.run(oldEdgeId);
  }

  for (const m of memories) {
    if (m.kind === "edge") continue;
    const oldNodeId = ids.node(m.namespace, m.key);
    const newNodeId = nodeIdMap.get(oldNodeId);
    if (newNodeId === undefined || oldNodeId === newNodeId) continue;
    stmts.deleteNodeLabelAssignmentsByNodeId.run(oldNodeId);
    stmts.deleteNodeById.run(oldNodeId);
  }

  moveNamespaceMetadata(db, nsMap, now);

  return { renamedMemories: memories.length };
}

function rematerializeEdges(
  ctx: DbCtx,
  nodeIdMap: ReadonlyMap<string, string>,
  memIdMap: ReadonlyMap<string, string>,
): Map<string, string> {
  const { db } = ctx;
  const edgeIdMap = new Map<string, string>();
  if (nodeIdMap.size === 0) return edgeIdMap;

  const oldNodeIds = [...nodeIdMap.keys()];
  const ph = oldNodeIds.map(() => "?").join(", ");
  const edges = db
    .query<EdgeRow, string[]>(
      `SELECT _id, from_node_id, to_node_id, properties, _ts_created FROM edges
       WHERE from_node_id IN (${ph}) OR to_node_id IN (${ph})`,
    )
    .all(...oldNodeIds, ...oldNodeIds);

  for (const e of edges) {
    const fromNodeId = nodeIdMap.get(e.from_node_id) ?? e.from_node_id;
    const toNodeId = nodeIdMap.get(e.to_node_id) ?? e.to_node_id;
    const fromNode = db
      .query<{ memory_id: string }, [string]>(`SELECT memory_id FROM nodes WHERE _id = ?`)
      .get(e.from_node_id);
    const toNode = db
      .query<{ memory_id: string }, [string]>(`SELECT memory_id FROM nodes WHERE _id = ?`)
      .get(e.to_node_id);
    if (!fromNode || !toNode) continue;
    const fromMemoryId = memIdMap.get(fromNode.memory_id) ?? fromNode.memory_id;
    const toMemoryId = memIdMap.get(toNode.memory_id) ?? toNode.memory_id;
    const labelRow = db
      .query<{ kind: string }, [string]>(
        `SELECT el.kind AS kind FROM edge_label_assignments ela
         INNER JOIN edge_labels el ON el._id = ela.label_id
         WHERE ela.edge_id = ? LIMIT 1`,
      )
      .get(e._id);
    const label = labelRow?.kind ?? "";
    const newEdgeId = ids.edge(fromNodeId, toNodeId, label, fromMemoryId, toMemoryId);
    edgeIdMap.set(e._id, newEdgeId);
    if (newEdgeId === e._id) continue;

    db.run(
      `INSERT INTO edges (_id, _ts_created, from_node_id, to_node_id, properties)
       VALUES (?, ?, ?, ?, ?)`,
      [newEdgeId, e._ts_created, fromNodeId, toNodeId, e.properties],
    );
    const elas = db
      .query<{ label_id: string; props: string; _ts_created: number }, [string]>(
        `SELECT label_id, props, _ts_created FROM edge_label_assignments WHERE edge_id = ?`,
      )
      .all(e._id);
    for (const a of elas) {
      const newAId = ids.edgeLabelAssignment(newEdgeId, a.label_id);
      db.run(
        `INSERT INTO edge_label_assignments (_id, _ts_created, edge_id, label_id, props)
         VALUES (?, ?, ?, ?, ?)`,
        [newAId, a._ts_created, newEdgeId, a.label_id, a.props],
      );
    }
  }

  return edgeIdMap;
}

function copyMemoryDependents(
  ctx: DbCtx,
  oldMemId: string,
  newMemId: string,
  nsMap: ReadonlyMap<string, string>,
): void {
  if (oldMemId === newMemId) return;
  const { db, stmts } = ctx;

  const sourceMaps = db
    .query<
      { _id: string; source_key: string; content_hash: string | null; _ts_created: number },
      [string]
    >(`SELECT _id, source_key, content_hash, _ts_created FROM source_maps WHERE memory_id = ?`)
    .all(oldMemId);

  const smIdMap = new Map<string, string>();
  for (const sm of sourceMaps) {
    const newSmId = ids.sourceMap(newMemId, sm.source_key);
    smIdMap.set(sm._id, newSmId);
    db.run(
      `INSERT INTO source_maps (_id, _ts_created, memory_id, source_key, content_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [newSmId, sm._ts_created, newMemId, sm.source_key, sm.content_hash],
    );
  }

  const textFeatures = db
    .query<{ _id: string; source_map_id: string; text: string; _ts_created: number }, [string]>(
      `SELECT _id, source_map_id, text, _ts_created FROM text_features WHERE memory_id = ?`,
    )
    .all(oldMemId);
  for (const tf of textFeatures) {
    const newSmId = smIdMap.get(tf.source_map_id) ?? tf.source_map_id;
    const newTfId = ids.textFeature(newSmId);
    db.run(
      `INSERT INTO text_features (_id, _ts_created, memory_id, source_map_id, text)
       VALUES (?, ?, ?, ?, ?)`,
      [newTfId, tf._ts_created, newMemId, newSmId, tf.text],
    );
    stmts.insertTextFeatureFts.run(newTfId, newMemId, newSmId, tf.text);
  }

  const vectorFeatures = db
    .query<
      { _id: string; source_map_id: string; vector: Uint8Array | Buffer; _ts_created: number },
      [string]
    >(`SELECT _id, source_map_id, vector, _ts_created FROM vector_features WHERE memory_id = ?`)
    .all(oldMemId);
  const ann = hasVectorAnnSearch(db);
  for (const vf of vectorFeatures) {
    const newSmId = smIdMap.get(vf.source_map_id) ?? vf.source_map_id;
    const newVfId = ids.vectorFeature(newSmId);
    const floats = blobToVector(
      vf.vector instanceof Buffer ? new Uint8Array(vf.vector) : vf.vector,
    );
    db.run(
      `INSERT INTO vector_features (_id, _ts_created, memory_id, source_map_id, vector)
       VALUES (?, ?, ?, ?, ?)`,
      [newVfId, vf._ts_created, newMemId, newSmId, vf.vector],
    );
    if (ann) {
      const dim = floats.length;
      vectorVecTableName(dim);
      ensureVectorFeaturesVecTable(db, dim);
      stmts.getInsertVectorVec(dim).run(newVfId, floats);
    }
  }

  const scopes = db
    .query<{ scope_id: string; _ts_created: number }, [string]>(
      `SELECT scope_id, _ts_created FROM memory_scopes WHERE memory_id = ?`,
    )
    .all(oldMemId);
  for (const s of scopes) {
    const newScopeId = nsMap.get(s.scope_id) ?? s.scope_id;
    stmts.insertIgnoreScope.run(newScopeId, s._ts_created);
    const msId = stableId("ms", newMemId, newScopeId);
    stmts.insertOrReplaceMemoryScope.run(msId, s._ts_created, newMemId, newScopeId);
  }
}

function deleteMemoryDependents(db: Database, ctx: DbCtx, memoryId: string): void {
  const { stmts } = ctx;
  stmts.deleteMemoryScopesByMemoryId.run(memoryId);
  deleteVectorVecRowsForMemory(db, stmts, memoryId);
  stmts.deleteTextFeaturesFtsByMemoryId.run(memoryId);
  stmts.deleteTextFeaturesByMemoryId.run(memoryId);
  stmts.deleteVectorFeaturesByMemoryId.run(memoryId);
  stmts.deleteSourceMapsByMemoryId.run(memoryId);
}

function moveNamespaceMetadata(
  db: Database,
  nsMap: ReadonlyMap<string, string>,
  now: number,
): void {
  for (const [oldNs, newNs] of nsMap) {
    if (oldNs === newNs) continue;
    const row = db
      .query<
        {
          display_name: string | null;
          description: string;
          _ts_created: number;
        },
        [string]
      >(`SELECT display_name, description, _ts_created FROM namespace_metadata WHERE _id = ?`)
      .get(oldNs);
    if (row === null) continue;
    db.run(
      `INSERT INTO namespace_metadata (_id, display_name, description, _ts_created, _ts_updated)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(_id) DO UPDATE SET
         display_name = excluded.display_name,
         description = excluded.description,
         _ts_updated = excluded._ts_updated`,
      [newNs, row.display_name, row.description, row._ts_created, now],
    );
    db.run(`DELETE FROM namespace_metadata WHERE _id = ?`, [oldNs]);
  }
}
