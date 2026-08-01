import type {
  GraphEdgeLink,
  GraphNode,
  HydratedNeighbor,
  HydratedSourceMapHit,
  LabelPropsSearchFormatter,
  MemoriesBackendCapabilities,
  MemoryOpContext,
  NamespaceMetadataInfo,
  NeighborFilter,
  OntologyLabelInstance,
  SearchNamespaceScope,
} from "../../../persistence/core";
import { namespacePath } from "../../../persistence/core/models/namespace-path";
import type {
  MemoriesPersistenceAsync,
  SourceMap,
  TextFeatureExportRow,
} from "../../../persistence/core/persistence";
import type { MemoryProvenanceEvent } from "../../../persistence/core/provenance";
import { createTursoClients, execSql, queryAll, queryOne, type TursoCredentials } from "./client";
import { type DbCtx, readCtx, writeCtx } from "./context";
import type { TursoDatabase } from "./db";
import { ctxExec } from "./db";
import { migrateMemoriesTursoServerless } from "./migrations";
import {
  appendDeleteOutboxEntry,
  appendMergeOutboxEntries,
  type ContentAtRootHit,
  getMemoryContentAtRootHex as getMemoryContentAtRootHexQuery,
  reconstructStoreAtRootHex as reconstructStoreAtRootHexQuery,
} from "./models/content-outbox";
import { insertEdgeLabelAssignment } from "./models/edge-label-assignments";
import { ensureEdgeLabel } from "./models/edge-labels";
import { insertEdge } from "./models/edges";
import {
  listIncidentGraphEdgesForMemory as listIncidentGraphEdgesQuery,
  loadGraphEdge as loadGraphEdgeQuery,
  loadGraphEdgesForNamespace as loadGraphEdgesQuery,
  loadGraphNode as loadGraphNodeQuery,
  loadNodeLabelsForMemory as loadNodeLabelsForMemoryQuery,
  loadNodeLabelsForNamespace as loadNodeLabelsQuery,
  loadNodePropertiesForMemory as loadNodePropertiesForMemoryQuery,
  loadNodePropertiesForNamespace as loadNodePropertiesQuery,
} from "./models/graph-index";
import { syncLabelPropsSearchFeatures as syncLabelPropsSearchFeaturesImpl } from "./models/label-props-search";
import { listSourceMapsForMemory as listSourceMapsForMemoryQuery } from "./models/list-source-maps-for-memory";
import { listTextFeatureExportRowsForMemory as listTextFeatureExportRowsForMemoryQuery } from "./models/list-text-feature-export-rows";
import {
  findMemoryAssociation,
  findMemoryIdByKey,
  isMemorySuppressed as isMemorySuppressedRow,
  loadMemoryNamespaceKey as loadMemoryNamespaceKeyRow,
  setMemorySuppressed as setMemorySuppressedRow,
  upsertMemory,
} from "./models/memories";
import {
  getProvenanceHeadRootHex,
  getProvenanceTimestampMsForRootHex as getProvenanceTsForRootHexQuery,
  appendProvenanceEvent as insertProvenanceRow,
} from "./models/memory-provenance";
import {
  buildCanonicalMemorySearchMetaText,
  listNeighborMemoriesForNode,
  syncMemorySearchMeta,
  upsertMemorySearchMetaVector,
} from "./models/memory-search-meta";
import { clearMemorySubtree } from "./models/memory-subtree";
import { insertNodeLabelAssignment } from "./models/node-label-assignments";
import { ensureNodeLabel } from "./models/node-labels";
import { nodeExists, upsertNodeForMemoryKey } from "./models/nodes";
import { renameNamespacePaths as renameNamespacePathsQuery } from "./models/rename-namespace";
import {
  linkScopes as linkScopesRow,
  listScopesForMemory as listScopesForMemoryRow,
  replaceMemoryScopes as replaceMemoryScopesRow,
  unlinkScopeEdge as unlinkScopeEdgeRow,
  upsertScope as upsertScopeRow,
} from "./models/scopes";
import {
  hydrateSourceMapHits,
  listNeighborsForEdgeMemory,
  listNeighborsForMemory,
  searchLexicalSourceMapIds,
  searchVectorSourceMapIds,
} from "./models/search";
import { insertSourceMap, updateSourceMapContentHash } from "./models/source-maps";
import { insertLexicalFeature } from "./models/text-features";
import { insertVectorFeature } from "./models/vector-features";
import { listVectorEmbeddingIndexDimensions as listVectorEmbeddingIndexDimensionsQuery } from "./models/vector-index-dimensions";
import { withWriteTransaction } from "./transactions";
import { VECTOR_FEATURES_ANN_INDEX_SQL } from "./turso-schema";

export type MemoriesTursoServerlessOptions = TursoCredentials & {
  db?: TursoDatabase;
  autoMigrate?: boolean;
  labelPropsSearchFormatter?: LabelPropsSearchFormatter;
};

export class MemoriesTursoServerlessPersistence {
  readonly capabilities: MemoriesBackendCapabilities;

  private readonly inTransaction = { current: false };
  private txCtx: DbCtx | undefined;

  constructor(
    readonly db: TursoDatabase,
    private readonly labelPropsSearchFormatter?: LabelPropsSearchFormatter,
    vectorAnnSearch = false,
  ) {
    this.capabilities = {
      lexicalSearch: true,
      vectorSearch: true,
      vectorKnnSearch: true,
      vectorAnnSearch,
      neighborIndex: true,
      graphIndex: true,
      multiNamespaceSearch: true,
      unscopedSearch: true,
      asOfTimestampMsSearch: true,
    };
  }

  private ctx(op: MemoryOpContext): DbCtx {
    return writeCtx(this.db, op.now);
  }

  private readDbCtx(): DbCtx {
    return readCtx(this.db);
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return withWriteTransaction(this.db.write, this.inTransaction, async (tx) => {
      this.txCtx = writeCtx(this.db, Date.now(), tx);
      try {
        return await fn();
      } finally {
        this.txCtx = undefined;
      }
    });
  }

  private activeCtx(op: MemoryOpContext): DbCtx {
    return this.txCtx ? { ...this.txCtx, now: op.now } : this.ctx(op);
  }

  async listNeighborMemoriesForNode(
    op: MemoryOpContext,
    namespace: string,
    nodeId: string,
  ): Promise<ReadonlyArray<{ namespace: string; key: string }>> {
    return listNeighborMemoriesForNode(this.activeCtx(op), namespace, nodeId);
  }

  async loadMemoryNamespaceKey(
    memoryId: string,
  ): Promise<{ namespace: string; key: string } | undefined> {
    return loadMemoryNamespaceKeyRow(this.readDbCtx(), memoryId);
  }

  async upsertScope(op: MemoryOpContext, input: { scopeId: string }): Promise<void> {
    await upsertScopeRow(this.activeCtx(op), input);
  }

  async upsertNamespaceMetadata(
    op: MemoryOpContext,
    input: {
      namespace: string;
      alias?: string | null;
      displayName?: string | null;
      description?: string;
    },
  ): Promise<void> {
    const ns = namespacePath(input.namespace);
    const existing = await queryOne<{ alias: string | null; description: string }>(
      this.db.read,
      `SELECT display_name AS alias, description FROM namespace_metadata WHERE _id = ?`,
      [ns],
    );
    const aliasPatch =
      input.alias !== undefined
        ? input.alias
        : input.displayName !== undefined
          ? input.displayName
          : undefined;
    const alias = aliasPatch !== undefined ? aliasPatch : (existing?.alias ?? null);
    const description =
      input.description !== undefined ? input.description : (existing?.description ?? "");
    if (existing) {
      await ctxExec(
        this.activeCtx(op),
        `UPDATE namespace_metadata SET display_name = ?, description = ?, _ts_updated = ? WHERE _id = ?`,
        [alias, description, op.now, ns],
      );
      return;
    }
    await ctxExec(
      this.activeCtx(op),
      `INSERT INTO namespace_metadata (_id, display_name, description, _ts_created, _ts_updated)
       VALUES (?, ?, ?, ?, ?)`,
      [ns, alias, description, op.now, op.now],
    );
  }

  async deleteNamespaceMetadata(op: MemoryOpContext, namespace: string): Promise<void> {
    const ns = namespacePath(namespace);
    await ctxExec(this.activeCtx(op), `DELETE FROM namespace_metadata WHERE _id = ?`, [ns]);
  }

  async renameNamespacePaths(
    op: MemoryOpContext,
    input: { nsMap: ReadonlyMap<string, string> },
  ): Promise<{ renamedMemories: number }> {
    return renameNamespacePathsQuery(this.activeCtx(op), input.nsMap);
  }

  async linkScopes(
    op: MemoryOpContext,
    input: { parentScopeId: string; childScopeId: string },
  ): Promise<void> {
    await linkScopesRow(this.activeCtx(op), input);
  }

  async unlinkScopeEdge(
    op: MemoryOpContext,
    input: { parentScopeId: string; childScopeId: string },
  ): Promise<void> {
    await unlinkScopeEdgeRow(this.activeCtx(op), input);
  }

  async replaceMemoryScopes(
    op: MemoryOpContext,
    input: { memoryId: string; scopeIds: readonly string[] },
  ): Promise<void> {
    await replaceMemoryScopesRow(this.activeCtx(op), input);
  }

  async listScopesForMemory(memoryId: string): Promise<string[]> {
    return listScopesForMemoryRow(this.readDbCtx(), memoryId);
  }

  async clearMemorySubtree(
    op: MemoryOpContext,
    input:
      | { memoryKind: "node"; memoryId: string; nodeId: string }
      | { memoryKind: "edge"; memoryId: string; edgeId: string },
  ): Promise<void> {
    await clearMemorySubtree(this.activeCtx(op), input);
  }

  async findMemoryAssociation(
    namespace: string,
    key: string,
  ): Promise<
    | { memoryId: string; kind: "node"; nodeId: string }
    | { memoryId: string; kind: "edge"; edgeId: string }
    | undefined
  > {
    return findMemoryAssociation(this.readDbCtx(), namespace, key);
  }

  async upsertMemory(
    op: MemoryOpContext,
    input: {
      namespace: string;
      key: string;
      kind?: "node" | "edge";
      edgeId?: string | null;
    },
  ): Promise<{ memoryId: string; _ts_created: number }> {
    return upsertMemory(this.activeCtx(op), input);
  }

  async upsertNodeForMemoryKey(
    op: MemoryOpContext,
    input: {
      namespace: string;
      memoryKey: string;
      memoryId: string;
      properties?: Record<string, unknown>;
    },
  ): Promise<{ nodeId: string }> {
    return upsertNodeForMemoryKey(this.activeCtx(op), input);
  }

  async insertSourceMap(
    op: MemoryOpContext,
    input: { memoryId: string; sourceKey: string },
  ): Promise<{ sourceMapId: string }> {
    return insertSourceMap(this.activeCtx(op), input);
  }

  async getProvenanceHeadRootHex(): Promise<string | undefined> {
    return getProvenanceHeadRootHex(this.db);
  }

  async getProvenanceTimestampMsForRootHex(rootHex: string): Promise<number | undefined> {
    return getProvenanceTsForRootHexQuery(this.db, rootHex);
  }

  async appendProvenanceEvent(
    op: MemoryOpContext,
    event: MemoryProvenanceEvent,
  ): Promise<{ root_hex: string }> {
    return insertProvenanceRow(this.activeCtx(op), event);
  }

  async appendContentOutbox(
    op: MemoryOpContext,
    input: {
      root_hex: string;
      event_type: "MERGE_MEMORY" | "DELETE_MEMORY";
      namespace: string;
      memoryKey: string;
      entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
    },
  ): Promise<void> {
    const ctx = this.activeCtx(op);
    if (input.event_type === "DELETE_MEMORY") {
      await appendDeleteOutboxEntry(ctx, {
        root_hex: input.root_hex,
        namespace: input.namespace,
        memoryKey: input.memoryKey,
      });
    } else {
      await appendMergeOutboxEntries(ctx, {
        root_hex: input.root_hex,
        namespace: input.namespace,
        memoryKey: input.memoryKey,
        entries: input.entries,
      });
    }
  }

  async getMemoryContentAtRootHex(
    rootHex: string,
    namespace: string,
    memoryKey: string,
  ): Promise<ContentAtRootHit[]> {
    return getMemoryContentAtRootHexQuery(this.db, rootHex, namespace, memoryKey);
  }

  async reconstructStoreAtRootHex(rootHex: string): Promise<ContentAtRootHit[]> {
    return reconstructStoreAtRootHexQuery(this.db, rootHex);
  }

  async updateSourceMapContentHash(
    op: MemoryOpContext,
    input: { sourceMapId: string; text?: string; vector?: Float32Array },
  ): Promise<void> {
    await updateSourceMapContentHash(this.activeCtx(op), input);
  }

  async insertLexicalFeature(
    op: MemoryOpContext,
    input: { memoryId: string; sourceMapId: string; text: string },
  ): Promise<{ textFeatureId: string }> {
    return insertLexicalFeature(this.activeCtx(op), input);
  }

  async insertVectorFeature(
    op: MemoryOpContext,
    input: { memoryId: string; sourceMapId: string; vector: Float32Array },
  ): Promise<{ vectorFeatureId: string }> {
    return insertVectorFeature(this.activeCtx(op), input);
  }

  async ensureNodeLabel(
    op: MemoryOpContext,
    input: { kind: string; description?: string; schemaJson?: string | null },
  ): Promise<string> {
    return ensureNodeLabel(this.activeCtx(op), input);
  }

  async insertNodeLabelAssignment(
    op: MemoryOpContext,
    input: { nodeId: string; labelId: string; props: Record<string, unknown> },
  ): Promise<void> {
    await insertNodeLabelAssignment(this.activeCtx(op), input);
  }

  async findMemoryIdByKey(namespace: string, key: string): Promise<string | undefined> {
    return findMemoryIdByKey(this.readDbCtx(), namespace, key);
  }

  async nodeExists(nodeId: string): Promise<boolean> {
    return nodeExists(this.readDbCtx(), nodeId);
  }

  async insertEdge(
    op: MemoryOpContext,
    input: {
      fromNodeId: string;
      toNodeId: string;
      properties?: Record<string, unknown>;
      idParts: { label: string; fromMemoryId: string; toMemoryId: string };
    },
  ): Promise<{ edgeId: string }> {
    return insertEdge(this.activeCtx(op), input);
  }

  async ensureEdgeLabel(
    op: MemoryOpContext,
    input: { kind: string; description?: string; schemaJson?: string | null },
  ): Promise<string> {
    return ensureEdgeLabel(this.activeCtx(op), input);
  }

  async insertEdgeLabelAssignment(
    op: MemoryOpContext,
    input: { edgeId: string; labelId: string; props: Record<string, unknown> },
  ): Promise<void> {
    await insertEdgeLabelAssignment(this.activeCtx(op), input);
  }

  async syncMemorySearchMeta(
    op: MemoryOpContext,
    input: { namespace: string; memoryKey: string; metaVector?: Float32Array },
  ): Promise<void> {
    await syncMemorySearchMeta(this.activeCtx(op), input);
  }

  async syncLabelPropsSearchFeatures(
    op: MemoryOpContext,
    input: { namespace: string; memoryKey: string },
  ): Promise<void> {
    await syncLabelPropsSearchFeaturesImpl(this.activeCtx(op), {
      ...input,
      formatLabelProps: this.labelPropsSearchFormatter,
    });
  }

  async buildCanonicalMemorySearchMetaText(
    op: MemoryOpContext,
    namespace: string,
    memoryKey: string,
  ): Promise<string> {
    return buildCanonicalMemorySearchMetaText(this.activeCtx(op), namespace, memoryKey);
  }

  async upsertMemorySearchMetaVector(
    op: MemoryOpContext,
    input: { namespace: string; memoryKey: string; vector: Float32Array },
  ): Promise<void> {
    await upsertMemorySearchMetaVector(this.activeCtx(op), input);
  }

  async deleteMemoryRootRows(
    input:
      | { memoryKind: "node"; memoryId: string; nodeId: string }
      | { memoryKind: "edge"; edgeId: string },
  ): Promise<void> {
    const ctx = this.txCtx ?? this.readDbCtx();
    if (input.memoryKind === "node") {
      await ctxExec(ctx, `DELETE FROM memories WHERE _id = ?`, [input.memoryId]);
      await ctxExec(ctx, `DELETE FROM nodes WHERE _id = ?`, [input.nodeId]);
      return;
    }
    await ctxExec(ctx, `DELETE FROM edges WHERE _id = ?`, [input.edgeId]);
  }

  async isMemorySuppressed(memoryId: string): Promise<boolean> {
    return isMemorySuppressedRow(this.txCtx ?? this.readDbCtx(), memoryId);
  }

  async setMemorySuppressed(
    op: MemoryOpContext,
    input: { memoryId: string; suppressed: boolean },
  ): Promise<void> {
    await setMemorySuppressedRow(this.activeCtx(op), input);
  }

  async searchLexicalSourceMapIds(input: {
    scope: SearchNamespaceScope;
    text: string;
    limit: number;
    memoryIds?: string[];
    asOfTimestampMs?: number;
  }): Promise<string[]> {
    return searchLexicalSourceMapIds(this.readDbCtx(), input);
  }

  async searchVectorSourceMapIds(input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOfTimestampMs?: number;
    method: "knn" | "ann";
  }): Promise<{ sourceMapIds: string[]; vectorSearchMethod?: "knn" | "ann" }> {
    if (input.method === "ann" && !this.capabilities.vectorAnnSearch) {
      return { sourceMapIds: [] };
    }
    if (input.method === "knn" && !this.capabilities.vectorKnnSearch) {
      return { sourceMapIds: [] };
    }
    return searchVectorSourceMapIds(this.readDbCtx(), input);
  }

  async hydrateSourceMapHits(sourceMapIds: readonly string[]): Promise<HydratedSourceMapHit[]> {
    return hydrateSourceMapHits(this.readDbCtx(), sourceMapIds);
  }

  async listNeighborsForMemory<
    EDGE_LABEL extends string = string,
    NODE_LABEL extends string = string,
  >(input: {
    namespace: string;
    key: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  }): Promise<HydratedNeighbor[]> {
    return listNeighborsForMemory<EDGE_LABEL, NODE_LABEL>(this.readDbCtx(), input);
  }

  async listNeighborsForEdgeMemory<
    EDGE_LABEL extends string = string,
    NODE_LABEL extends string = string,
  >(input: {
    namespace: string;
    edgeId: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
  }): Promise<HydratedNeighbor[]> {
    return listNeighborsForEdgeMemory<EDGE_LABEL, NODE_LABEL>(this.readDbCtx(), input);
  }

  async listMemoryNamespaces(): Promise<string[]> {
    const rows = await queryAll<{ namespace: string }>(
      this.db.read,
      `SELECT DISTINCT namespace FROM memories ORDER BY namespace`,
    );
    return rows.map((row) => row.namespace);
  }

  async listNamespacesWithMetadata(): Promise<NamespaceMetadataInfo[]> {
    const byKey = new Map<string, NamespaceMetadataInfo>();
    for (const row of await queryAll<{ namespace: string }>(
      this.db.read,
      `SELECT DISTINCT namespace FROM memories`,
    )) {
      byKey.set(row.namespace, {
        namespace: row.namespace,
        alias: null,
        description: "",
      });
    }
    for (const row of await queryAll<{
      id: string;
      alias: string | null;
      description: string;
    }>(
      this.db.read,
      `SELECT _id AS id, display_name AS alias, description FROM namespace_metadata`,
    )) {
      byKey.set(row.id, {
        namespace: row.id,
        alias: row.alias,
        description: row.description,
      });
    }
    return [...byKey.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
  }

  async getNamespaceMetadata(namespace: string): Promise<NamespaceMetadataInfo | undefined> {
    const ns = namespacePath(namespace);
    const row = await queryOne<{
      id: string;
      alias: string | null;
      description: string;
    }>(
      this.db.read,
      `SELECT _id AS id, display_name AS alias, description FROM namespace_metadata WHERE _id = ?`,
      [ns],
    );
    return row ? { namespace: row.id, alias: row.alias, description: row.description } : undefined;
  }

  async listMemoryKeysInNamespace(namespace: string): Promise<string[]> {
    const ns = namespacePath(namespace);
    const rows = await queryAll<{ key: string }>(
      this.db.read,
      `SELECT key FROM memories WHERE namespace = ?`,
      [ns],
    );
    return rows.map((r) => r.key);
  }

  async listSourceMapsForMemory(memoryId: string, limit: number): Promise<SourceMap[]> {
    return listSourceMapsForMemoryQuery(this.readDbCtx(), memoryId, limit);
  }

  async listTextFeatureExportRowsForMemory(memoryId: string): Promise<TextFeatureExportRow[]> {
    return listTextFeatureExportRowsForMemoryQuery(this.readDbCtx(), memoryId);
  }

  async getSourceMapTextPreview(sourceMapId: string, maxChars = 8000): Promise<string | null> {
    const rows = await queryAll<{ text: string }>(
      this.db.read,
      `SELECT tf.text AS text
       FROM text_features tf
       WHERE tf.source_map_id = ?
       ORDER BY tf._ts_created ASC, tf._id ASC`,
      [sourceMapId],
    );
    if (rows.length === 0) return null;
    const joined = rows.map((row) => row.text).join("\n\n");
    if (joined.length <= maxChars) return joined;
    return `${joined.slice(0, Math.max(0, maxChars - 1))}…`;
  }

  async listVectorEmbeddingIndexDimensions(): Promise<number[]> {
    return listVectorEmbeddingIndexDimensionsQuery(this.db);
  }

  async loadGraphEdgesForNamespace(namespace: string): Promise<GraphEdgeLink[]> {
    if (!this.capabilities.graphIndex) return [];
    return loadGraphEdgesQuery(this.db, namespace);
  }

  async loadNodeLabelsForNamespace(
    namespace: string,
  ): Promise<Map<string, OntologyLabelInstance[]>> {
    if (!this.capabilities.graphIndex) return new Map();
    return loadNodeLabelsQuery(this.db, namespace);
  }

  async loadNodePropertiesForNamespace(
    namespace: string,
  ): Promise<Map<string, Record<string, unknown> | null>> {
    if (!this.capabilities.graphIndex) return new Map();
    return loadNodePropertiesQuery(this.db, namespace);
  }

  async listIncidentGraphEdges(namespace: string, memoryKey: string): Promise<GraphEdgeLink[]> {
    if (!this.capabilities.graphIndex) return [];
    return listIncidentGraphEdgesQuery(this.db, namespace, memoryKey);
  }

  async loadNodeLabelsForMemory(namespace: string, memoryKey: string) {
    if (!this.capabilities.graphIndex) return [];
    return loadNodeLabelsForMemoryQuery(this.db, namespace, memoryKey);
  }

  async loadNodePropertiesForMemory(
    namespace: string,
    memoryKey: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.capabilities.graphIndex) return null;
    return loadNodePropertiesForMemoryQuery(this.db, namespace, memoryKey);
  }

  async loadGraphEdge(namespace: string, edgeId: string): Promise<GraphEdgeLink | null> {
    if (!this.capabilities.graphIndex) return null;
    return loadGraphEdgeQuery(this.db, namespace, edgeId);
  }

  async loadGraphNode(namespace: string, memoryKey: string): Promise<GraphNode | null> {
    if (!this.capabilities.graphIndex) return null;
    return loadGraphNodeQuery(this.db, namespace, memoryKey);
  }
}

export async function createMemoriesTursoServerlessPersistence(
  options: MemoriesTursoServerlessOptions,
): Promise<MemoriesPersistenceAsync> {
  const db = options.db ?? createTursoClients(options);
  if (options.autoMigrate !== false) {
    await migrateMemoriesTursoServerless(db);
  }
  let vectorAnnSearch = false;
  try {
    await execSql(db.write, VECTOR_FEATURES_ANN_INDEX_SQL);
    vectorAnnSearch = true;
  } catch {
    // Some Turso deployments do not expose libSQL vector indexes.
  }
  return new MemoriesTursoServerlessPersistence(
    db,
    options.labelPropsSearchFormatter,
    vectorAnnSearch,
  ) as unknown as MemoriesPersistenceAsync;
}

export { migrateMemoriesTursoServerless };
