import type { Database, Statement } from "bun:sqlite";
import { vectorVecTableName } from "../search-indexes";

/**
 * Cache of prepared statements used by every model module. Prepared once when
 * {@link prepareMemoriesSqliteStmts} runs and stored on every {@link DbCtx} created by
 * {@link MemoriesPersistence}.
 *
 * Statements with dynamic table names (one per vector dimension) are lazily prepared per dim
 * via {@link MemoriesSqliteStmts.getInsertVectorVec} / {@link MemoriesSqliteStmts.getDeleteVectorVecByFeatureId} /
 * {@link MemoriesSqliteStmts.getDeleteVectorVecByTable}.
 */
export type MemoriesSqliteStmts = {
  // edges
  insertEdge: Statement;

  // edge-labels
  updateEdgeLabel: Statement;
  insertEdgeLabel: Statement;

  // edge-label-assignments
  insertEdgeLabelAssignment: Statement;

  // memories
  insertOrUpdateMemory: Statement;

  // memory-provenance
  insertMemoryProvenance: Statement;

  // memory-content-outbox
  insertContentOutbox: Statement;

  // memory-search-meta (static parts; dynamic vec tables handled via getters below)
  deleteTextFeaturesFtsByTextFeatureId: Statement;
  deleteTextFeaturesFtsBySourceMapId: Statement;
  deleteTextFeaturesBySourceMapId: Statement;
  deleteVectorFeaturesByFeatureId: Statement;
  deleteSourceMapById: Statement;

  // memory-subtree
  deleteMemoryScopesByMemoryId: Statement;
  deleteTextFeaturesFtsByMemoryId: Statement;
  deleteTextFeaturesByMemoryId: Statement;
  deleteVectorFeaturesByMemoryId: Statement;
  deleteSourceMapsByMemoryId: Statement;
  deleteMemoriesByIncidentEdgeNodeId: Statement;
  deleteEdgesByIncidentNodeId: Statement;
  deleteNodeLabelAssignmentsByNodeId: Statement;
  deleteEdgeLabelAssignmentsByEdgeId: Statement;

  // node-labels
  updateNodeLabel: Statement;
  insertNodeLabel: Statement;

  // node-label-assignments
  insertNodeLabelAssignment: Statement;

  // nodes
  upsertNode: Statement;

  // scopes
  deleteAllScopeClosure: Statement;
  insertScopeClosure: Statement;
  insertIgnoreScope: Statement;
  deleteScopeEdge: Statement;
  deleteMemoryScopes: Statement;
  insertOrReplaceScopeEdge: Statement;
  insertOrReplaceMemoryScope: Statement;

  // source-maps
  insertSourceMap: Statement;
  updateSourceMapContentHash: Statement;

  // text-features
  insertTextFeature: Statement;
  insertTextFeatureFts: Statement;

  // vector-features (static row)
  insertVectorFeatureRow: Statement;

  // memories root-row deletes (from persistence.ts)
  deleteMemoryById: Statement;
  deleteNodeById: Statement;
  deleteEdgeById: Statement;

  // read-only listing
  listSourceMapsForMemory: Statement;
  listTextFeatureExportRowsForMemory: Statement;

  // Dynamic-table accessors for vec0 virtual tables (one per dim).
  getInsertVectorVec(dim: number): Statement;
  getDeleteVectorVecByFeatureId(dim: number): Statement;
  /** Used by `deleteVectorVecRowsForMemory` which iterates every existing `vec_features_dim<N>` table. */
  getDeleteVectorVecByMemoryIdForTable(tableName: string): Statement;
};

export function prepareMemoriesSqliteStmts(db: Database): MemoriesSqliteStmts {
  const insertVectorVecByDim = new Map<number, Statement>();
  const deleteVectorVecByFeatureIdByDim = new Map<number, Statement>();
  const deleteVectorVecByMemoryIdByTable = new Map<string, Statement>();

  return {
    insertEdge: db.prepare(
      `INSERT OR REPLACE INTO edges (_id, _ts_created, from_node_id, to_node_id, properties) VALUES (?, ?, ?, ?, ?)`,
    ),

    updateEdgeLabel: db.prepare(`UPDATE edge_labels SET description = ?, schema = ? WHERE _id = ?`),
    insertEdgeLabel: db.prepare(
      `INSERT INTO edge_labels (_id, _ts_created, kind, description, schema) VALUES (?, ?, ?, ?, ?)`,
    ),

    insertEdgeLabelAssignment: db.prepare(
      `INSERT OR REPLACE INTO edge_label_assignments (_id, _ts_created, edge_id, label_id, props) VALUES (?, ?, ?, ?, ?)`,
    ),

    insertOrUpdateMemory: db.prepare(
      `INSERT INTO memories (_id, _ts_created, namespace, key, kind, edge_id, ns_prefix_1, ns_prefix_2, ns_prefix_3, ns_prefix_4, ns_prefix_5, ns_prefix_6)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(_id) DO UPDATE SET
         namespace = excluded.namespace,
         key = excluded.key,
         kind = excluded.kind,
         edge_id = excluded.edge_id,
         ns_prefix_1 = excluded.ns_prefix_1,
         ns_prefix_2 = excluded.ns_prefix_2,
         ns_prefix_3 = excluded.ns_prefix_3,
         ns_prefix_4 = excluded.ns_prefix_4,
         ns_prefix_5 = excluded.ns_prefix_5,
         ns_prefix_6 = excluded.ns_prefix_6`,
    ),

    insertMemoryProvenance: db.prepare(
      `INSERT INTO memory_provenance (_id, _ts_created, parent_root_hex, root_hex, event_type, event_json, intent_snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),

    insertContentOutbox: db.prepare(
      `INSERT OR IGNORE INTO memory_content_outbox (_id, _ts_created, root_hex, event_type, namespace, memory_key, source_key, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),

    deleteTextFeaturesFtsByTextFeatureId: db.prepare(
      `DELETE FROM text_features_fts WHERE text_feature_id = ?`,
    ),
    deleteTextFeaturesFtsBySourceMapId: db.prepare(
      `DELETE FROM text_features_fts WHERE source_map_id = ?`,
    ),
    deleteTextFeaturesBySourceMapId: db.prepare(
      `DELETE FROM text_features WHERE source_map_id = ?`,
    ),
    deleteVectorFeaturesByFeatureId: db.prepare(`DELETE FROM vector_features WHERE _id = ?`),
    deleteSourceMapById: db.prepare(`DELETE FROM source_maps WHERE _id = ?`),

    deleteMemoryScopesByMemoryId: db.prepare(`DELETE FROM memory_scopes WHERE memory_id = ?`),
    deleteTextFeaturesFtsByMemoryId: db.prepare(
      `DELETE FROM text_features_fts WHERE memory_id = ?`,
    ),
    deleteTextFeaturesByMemoryId: db.prepare(`DELETE FROM text_features WHERE memory_id = ?`),
    deleteVectorFeaturesByMemoryId: db.prepare(`DELETE FROM vector_features WHERE memory_id = ?`),
    deleteSourceMapsByMemoryId: db.prepare(`DELETE FROM source_maps WHERE memory_id = ?`),
    deleteMemoriesByIncidentEdgeNodeId: db.prepare(
      `DELETE FROM memories WHERE edge_id IN (
         SELECT _id FROM edges WHERE from_node_id = ? OR to_node_id = ?
       )`,
    ),
    deleteEdgesByIncidentNodeId: db.prepare(
      `DELETE FROM edges WHERE from_node_id = ? OR to_node_id = ?`,
    ),
    deleteNodeLabelAssignmentsByNodeId: db.prepare(
      `DELETE FROM node_label_assignments WHERE node_id = ?`,
    ),
    deleteEdgeLabelAssignmentsByEdgeId: db.prepare(
      `DELETE FROM edge_label_assignments WHERE edge_id = ?`,
    ),

    updateNodeLabel: db.prepare(`UPDATE node_labels SET description = ?, schema = ? WHERE _id = ?`),
    insertNodeLabel: db.prepare(
      `INSERT INTO node_labels (_id, _ts_created, kind, description, schema) VALUES (?, ?, ?, ?, ?)`,
    ),

    insertNodeLabelAssignment: db.prepare(
      `INSERT OR REPLACE INTO node_label_assignments (_id, _ts_created, node_id, label_id, props) VALUES (?, ?, ?, ?, ?)`,
    ),

    upsertNode: db.prepare(
      `INSERT INTO nodes (_id, _ts_created, memory_id, value, properties) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(_id) DO UPDATE SET memory_id = excluded.memory_id, value = excluded.value, properties = excluded.properties`,
    ),

    deleteAllScopeClosure: db.prepare(`DELETE FROM scope_closure`),
    insertScopeClosure: db.prepare(
      `INSERT OR REPLACE INTO scope_closure (_id, _ts_created, ancestor_scope_id, descendant_scope_id)
       VALUES (?, ?, ?, ?)`,
    ),
    insertIgnoreScope: db.prepare(`INSERT OR IGNORE INTO scopes (_id, _ts_created) VALUES (?, ?)`),
    deleteScopeEdge: db.prepare(
      `DELETE FROM scope_edges WHERE parent_scope_id = ? AND child_scope_id = ?`,
    ),
    deleteMemoryScopes: db.prepare(`DELETE FROM memory_scopes WHERE memory_id = ?`),
    insertOrReplaceScopeEdge: db.prepare(
      `INSERT OR REPLACE INTO scope_edges (_id, _ts_created, parent_scope_id, child_scope_id)
       VALUES (?, ?, ?, ?)`,
    ),
    insertOrReplaceMemoryScope: db.prepare(
      `INSERT OR REPLACE INTO memory_scopes (_id, _ts_created, memory_id, scope_id)
       VALUES (?, ?, ?, ?)`,
    ),

    insertSourceMap: db.prepare(
      `INSERT INTO source_maps (_id, _ts_created, memory_id, source_key) VALUES (?, ?, ?, ?)`,
    ),
    updateSourceMapContentHash: db.prepare(`UPDATE source_maps SET content_hash = ? WHERE _id = ?`),

    insertTextFeature: db.prepare(
      `INSERT INTO text_features (_id, _ts_created, memory_id, source_map_id, text) VALUES (?, ?, ?, ?, ?)`,
    ),
    insertTextFeatureFts: db.prepare(
      `INSERT INTO text_features_fts (text_feature_id, memory_id, source_map_id, text) VALUES (?, ?, ?, ?)`,
    ),

    insertVectorFeatureRow: db.prepare(
      `INSERT INTO vector_features (_id, _ts_created, memory_id, source_map_id, vector) VALUES (?, ?, ?, ?, ?)`,
    ),

    deleteMemoryById: db.prepare(`DELETE FROM memories WHERE _id = ?`),
    deleteNodeById: db.prepare(`DELETE FROM nodes WHERE _id = ?`),
    deleteEdgeById: db.prepare(`DELETE FROM edges WHERE _id = ?`),

    listSourceMapsForMemory: db.prepare(
      `SELECT _id, _ts_created, memory_id, source_key, content_hash
       FROM source_maps
       WHERE memory_id = ?
       ORDER BY _ts_created DESC
       LIMIT ?`,
    ),
    listTextFeatureExportRowsForMemory: db.prepare(
      `SELECT sm.memory_id AS memory_id, sm.source_key AS source_key, tf.text AS text
       FROM text_features tf
       INNER JOIN source_maps sm ON tf.source_map_id = sm._id
       WHERE sm.memory_id = ?`,
    ),

    getInsertVectorVec(dim: number): Statement {
      const cached = insertVectorVecByDim.get(dim);
      if (cached !== undefined) return cached;
      const vTable = vectorVecTableName(dim).replaceAll('"', '""');
      const stmt = db.prepare(
        `INSERT INTO "${vTable}" (vector_feature_id, embedding) VALUES (?, ?)`,
      );
      insertVectorVecByDim.set(dim, stmt);
      return stmt;
    },
    getDeleteVectorVecByFeatureId(dim: number): Statement {
      const cached = deleteVectorVecByFeatureIdByDim.get(dim);
      if (cached !== undefined) return cached;
      const vTable = vectorVecTableName(dim).replaceAll('"', '""');
      const stmt = db.prepare(`DELETE FROM "${vTable}" WHERE vector_feature_id = ?`);
      deleteVectorVecByFeatureIdByDim.set(dim, stmt);
      return stmt;
    },
    getDeleteVectorVecByMemoryIdForTable(tableName: string): Statement {
      const cached = deleteVectorVecByMemoryIdByTable.get(tableName);
      if (cached !== undefined) return cached;
      const escaped = tableName.replaceAll('"', '""');
      const stmt = db.prepare(
        `DELETE FROM "${escaped}"
         WHERE vector_feature_id IN (SELECT _id FROM vector_features WHERE memory_id = ?)`,
      );
      deleteVectorVecByMemoryIdByTable.set(tableName, stmt);
      return stmt;
    },
  };
}
