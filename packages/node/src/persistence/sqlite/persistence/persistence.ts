import type { Database } from "bun:sqlite";
import type {
  GraphEdgeLink,
  GraphNamespaceCounts,
  GraphNamespaceStats,
  GraphNode,
  MemoriesPersistence as IMemoriesPersistence,
  LabelPropsSearchFormatter,
  MemoriesBackendCapabilities,
  MemoryOpContext,
  NamespaceMetadataInfo,
  NamespacePathPolicy,
  NeighborFilter,
  SearchAsOf,
  SearchNamespaceScope,
} from "../../../persistence/core";
import { resolveNamespacePathPolicy } from "../../../persistence/core";
import type { SourceMap, TextFeatureExportRow } from "../../../persistence/core/persistence";
import type { ContentBlobColdStore } from "../../../persistence/core/persistence/content-blob-cold-store";
import { DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS } from "../../../persistence/core/persistence/content-blob-cold-store";
import type { MemoryProvenanceEvent } from "../../../persistence/core/provenance";
import {
  type BunS3ContentBlobColdStoreOptions,
  createBunS3ContentBlobColdStore,
} from "./content-blob-cold-store-bun";
import { clearSourceMapFeatures as clearSourceMapFeaturesQuery } from "./models/clear-source-map-features";
import {
  appendDeleteOutboxEntry,
  appendMergeOutboxEntries,
  type ContentAtRootHit,
  evacuateContentBlobsOutsideHotWindow,
  getMemoryContentAtRootHexAsync as getMemoryContentAtRootHexAsyncQuery,
  getMemoryContentAtRootHex as getMemoryContentAtRootHexQuery,
  reconstructStoreAtRootHexAsync as reconstructStoreAtRootHexAsyncQuery,
  reconstructStoreAtRootHex as reconstructStoreAtRootHexQuery,
} from "./models/content-outbox";
import type { DbCtx } from "./models/context";
import { insertEdgeLabelAssignment } from "./models/edge-label-assignments";
import { ensureEdgeLabel } from "./models/edge-labels";
import { insertEdge } from "./models/edges";
import {
  countGraphForNamespace as countGraphForNamespaceQuery,
  listIncidentGraphEdgesForMemory as listIncidentGraphEdgesQuery,
  listSuppressedNodeKeysForNamespace as listSuppressedNodeKeysForNamespaceQuery,
  loadGraphEdge as loadGraphEdgeQuery,
  loadGraphEdgesForNamespace as loadGraphEdgesQuery,
  loadGraphNode as loadGraphNodeQuery,
  loadNodeLabelsForMemory as loadNodeLabelsForMemoryQuery,
  loadNodeLabelsForNamespace as loadNodeLabelsQuery,
  loadNodePropertiesForMemory as loadNodePropertiesForMemoryQuery,
  loadNodePropertiesForNamespace as loadNodePropertiesQuery,
  statsGraphForNamespace as statsGraphForNamespaceQuery,
} from "./models/graph-index";
import { syncLabelPropsSearchFeatures as syncLabelPropsSearchFeaturesImpl } from "./models/label-props-search";
import { listMemoryNamespaces as listMemoryNamespacesQuery } from "./models/list-memory-namespaces";
import { listSourceMapInventoryForMemory as listSourceMapInventoryForMemoryQuery } from "./models/list-source-map-inventory-for-memory";
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
  listProvenanceChain as listProvenanceChainQuery,
  listProvenanceEvents as listProvenanceEventsQuery,
} from "./models/memory-provenance";
import {
  buildCanonicalMemorySearchMetaText,
  listNeighborMemoriesForNode,
  syncMemorySearchMeta,
  upsertMemorySearchMetaVector,
} from "./models/memory-search-meta";
import { clearMemorySubtree } from "./models/memory-subtree";
import {
  deleteNamespaceMetadata as deleteNamespaceMetadataQuery,
  findClosestSuppressedNamespace as findClosestSuppressedNamespaceQuery,
  getNamespaceMetadata as getNamespaceMetadataQuery,
  isNamespaceSuppressed as isNamespaceSuppressedQuery,
  listMemoryKeysInNamespace as listMemoryKeysInNamespaceQuery,
  listNamespacesWithMetadata as listNamespacesWithMetadataQuery,
  listNamespacesWithMetadataUnderPrefix as listNamespacesWithMetadataUnderPrefixQuery,
  namespaceExistsUnderPrefix as namespaceExistsUnderPrefixQuery,
  setNamespaceSuppressed as setNamespaceSuppressedQuery,
  upsertNamespaceMetadata as upsertNamespaceMetadataQuery,
} from "./models/namespace-metadata";
import { insertNodeLabelAssignment } from "./models/node-label-assignments";
import { ensureNodeLabel } from "./models/node-labels";
import { nodeExists, upsertNodeForMemoryKey } from "./models/nodes";
import { type MemoriesSqliteStmts, prepareMemoriesSqliteStmts } from "./models/prepared-stmts";
import { renameNamespacePaths as renameNamespacePathsQuery } from "./models/rename-namespace";
import {
  linkScopes as linkScopesRow,
  listScopesForMemory as listScopesForMemoryRow,
  replaceMemoryScopes as replaceMemoryScopesRow,
  unlinkScopeEdge as unlinkScopeEdgeRow,
  upsertScope as upsertScopeRow,
} from "./models/scopes";
import {
  type HydratedNeighbor,
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
import { hasVectorAnnSearch } from "./search-indexes";

export class MemoriesPersistence implements IMemoriesPersistence {
  readonly capabilities: MemoriesBackendCapabilities;
  readonly namespacePathPolicy: NamespacePathPolicy;

  private readonly stmts: MemoriesSqliteStmts;
  private readonly contentOutboxRetentionTips: number;
  private readonly contentBlobColdStore: ContentBlobColdStore | undefined;

  constructor(
    private readonly db: Database,
    private readonly labelPropsSearchFormatter?: LabelPropsSearchFormatter,
    namespacePathPolicy?: NamespacePathPolicy,
    contentOutboxRetentionTips?: number,
    contentBlobColdStore?: ContentBlobColdStore,
  ) {
    this.namespacePathPolicy = resolveNamespacePathPolicy(namespacePathPolicy);
    this.contentOutboxRetentionTips =
      contentOutboxRetentionTips ?? DEFAULT_CONTENT_OUTBOX_RETENTION_TIPS;
    this.contentBlobColdStore = contentBlobColdStore;
    this.capabilities = {
      lexicalSearch: true,
      vectorSearch: true,
      vectorKnnSearch: true,
      vectorAnnSearch: hasVectorAnnSearch(db),
      neighborIndex: true,
      graphIndex: true,
      multiNamespaceSearch: true,
      unscopedSearch: true,
      asOfTimestampMsSearch: true,
    };
    this.stmts = prepareMemoriesSqliteStmts(db);
  }

  private ctx(op: MemoryOpContext): DbCtx {
    return { db: this.db, now: op.now, stmts: this.stmts };
  }

  private readCtx(): DbCtx {
    return { db: this.db, now: 0, stmts: this.stmts };
  }

  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  listNeighborMemoriesForNode(
    op: MemoryOpContext,
    namespace: string,
    nodeId: string,
  ): ReadonlyArray<{ namespace: string; key: string }> {
    return listNeighborMemoriesForNode(this.ctx(op), namespace, nodeId);
  }

  loadMemoryNamespaceKey(memoryId: string): { namespace: string; key: string } | undefined {
    return loadMemoryNamespaceKeyRow(this.readCtx(), memoryId);
  }

  upsertScope(op: MemoryOpContext, input: { scopeId: string }): void {
    upsertScopeRow(this.ctx(op), input);
  }

  upsertNamespaceMetadata(
    op: MemoryOpContext,
    input: {
      namespace: string;
      alias?: string | null;
      description?: string;
    },
  ): void {
    upsertNamespaceMetadataQuery(this.db, op, input);
  }

  deleteNamespaceMetadata(op: MemoryOpContext, namespace: string): void {
    deleteNamespaceMetadataQuery(this.db, op, namespace);
  }

  renameNamespacePaths(
    op: MemoryOpContext,
    input: { nsMap: ReadonlyMap<string, string> },
  ): { renamedMemories: number } {
    return renameNamespacePathsQuery(this.ctx(op), input.nsMap);
  }

  linkScopes(op: MemoryOpContext, input: { parentScopeId: string; childScopeId: string }): void {
    linkScopesRow(this.ctx(op), input);
  }

  unlinkScopeEdge(
    op: MemoryOpContext,
    input: { parentScopeId: string; childScopeId: string },
  ): void {
    unlinkScopeEdgeRow(this.ctx(op), input);
  }

  replaceMemoryScopes(
    op: MemoryOpContext,
    input: { memoryId: string; scopeIds: readonly string[] },
  ): void {
    replaceMemoryScopesRow(this.ctx(op), input);
  }

  listScopesForMemory(memoryId: string): string[] {
    return listScopesForMemoryRow(this.readCtx(), memoryId);
  }

  clearMemorySubtree(
    op: MemoryOpContext,
    input:
      | { memoryKind: "node"; memoryId: string; nodeId: string }
      | { memoryKind: "edge"; memoryId: string; edgeId: string },
  ): void {
    clearMemorySubtree(this.ctx(op), input);
  }

  clearSourceMapFeatures(op: MemoryOpContext, sourceMapId: string): void {
    clearSourceMapFeaturesQuery(this.ctx(op), sourceMapId);
  }

  findMemoryAssociation(
    namespace: string,
    key: string,
  ):
    | { memoryId: string; kind: "node"; nodeId: string }
    | { memoryId: string; kind: "edge"; edgeId: string }
    | undefined {
    return findMemoryAssociation(this.readCtx(), namespace, key);
  }

  upsertMemory(
    op: MemoryOpContext,
    input: {
      namespace: string;
      key: string;
      kind?: "node" | "edge";
      edgeId?: string | null;
    },
  ): { memoryId: string; _ts_created: number } {
    return upsertMemory(this.ctx(op), input);
  }

  upsertNodeForMemoryKey(
    op: MemoryOpContext,
    input: {
      namespace: string;
      memoryKey: string;
      memoryId: string;
      properties?: Record<string, unknown>;
    },
  ): { nodeId: string } {
    return upsertNodeForMemoryKey(this.ctx(op), input);
  }

  insertSourceMap(
    op: MemoryOpContext,
    input: { memoryId: string; sourceKey: string },
  ): { sourceMapId: string } {
    return insertSourceMap(this.ctx(op), input);
  }

  getProvenanceHeadRootHex(): string | undefined {
    return getProvenanceHeadRootHex(this.db);
  }

  getProvenanceTimestampMsForRootHex(rootHex: string): number | undefined {
    return getProvenanceTsForRootHexQuery(this.db, rootHex);
  }

  appendProvenanceEvent(op: MemoryOpContext, event: MemoryProvenanceEvent): { root_hex: string } {
    return insertProvenanceRow(this.ctx(op), event);
  }

  appendContentOutbox(
    op: MemoryOpContext,
    input: {
      root_hex: string;
      event_type: "MERGE_MEMORY" | "DELETE_MEMORY";
      namespace: string;
      memoryKey: string;
      entries: ReadonlyArray<{ sourceKey: string; text?: string }>;
    },
  ): void {
    const ctx = this.ctx(op);
    if (input.event_type === "DELETE_MEMORY") {
      appendDeleteOutboxEntry(ctx, {
        root_hex: input.root_hex,
        namespace: input.namespace,
        memoryKey: input.memoryKey,
      });
    } else {
      appendMergeOutboxEntries(ctx, {
        root_hex: input.root_hex,
        namespace: input.namespace,
        memoryKey: input.memoryKey,
        entries: input.entries,
      });
    }
    // Drop path is sync until the first await; run inline so short-lived DBs aren't
    // closed under a deferred microtask. Cold put may continue asynchronously.
    void evacuateContentBlobsOutsideHotWindow(this.db, {
      retentionTips: this.contentOutboxRetentionTips,
      coldStore: this.contentBlobColdStore,
    });
  }

  /**
   * Reconstruct text as of a provenance tip (hot blob only).
   * Cold-evacuated bodies need {@link getMemoryContentAtRootHexAsync}.
   *
   * Thin outbox rows are kept indefinitely; at extreme tip counts, scale by tiered
   * thinning of the outbox itself (segment old tips to cold files)—not implemented here.
   */
  getMemoryContentAtRootHex(
    rootHex: string,
    namespace: string,
    memoryKey: string,
  ): ContentAtRootHit[] {
    return getMemoryContentAtRootHexQuery(this.db, rootHex, namespace, memoryKey);
  }

  /** Like {@link getMemoryContentAtRootHex} but fetches cold S3 bodies when configured. */
  async getMemoryContentAtRootHexAsync(
    rootHex: string,
    namespace: string,
    memoryKey: string,
  ): Promise<ContentAtRootHit[]> {
    return getMemoryContentAtRootHexAsyncQuery(
      this.db,
      rootHex,
      namespace,
      memoryKey,
      this.contentBlobColdStore,
    );
  }

  /**
   * Reconstruct the text content of every memory in the store as of the given chain link.
   * Scans the full outbox — use {@link getMemoryContentAtRootHex} for single-key lookups.
   */
  reconstructStoreAtRootHex(rootHex: string): ContentAtRootHit[] {
    return reconstructStoreAtRootHexQuery(this.db, rootHex);
  }

  async reconstructStoreAtRootHexAsync(rootHex: string): Promise<ContentAtRootHit[]> {
    return reconstructStoreAtRootHexAsyncQuery(this.db, rootHex, this.contentBlobColdStore);
  }

  /** Run tip-window blob evacuation (S3 or drop). */
  async evacuateContentBlobs(): Promise<void> {
    await evacuateContentBlobsOutsideHotWindow(this.db, {
      retentionTips: this.contentOutboxRetentionTips,
      coldStore: this.contentBlobColdStore,
    });
  }

  updateSourceMapContentHash(
    op: MemoryOpContext,
    input: { sourceMapId: string; text?: string; vector?: Float32Array },
  ): void {
    updateSourceMapContentHash(this.ctx(op), input);
  }

  insertLexicalFeature(
    op: MemoryOpContext,
    input: { memoryId: string; sourceMapId: string; text: string },
  ): { textFeatureId: string } {
    return insertLexicalFeature(this.ctx(op), input);
  }

  insertVectorFeature(
    op: MemoryOpContext,
    input: { memoryId: string; sourceMapId: string; vector: Float32Array },
  ): { vectorFeatureId: string } {
    return insertVectorFeature(this.ctx(op), input);
  }

  ensureNodeLabel(
    op: MemoryOpContext,
    input: { kind: string; description?: string; schemaJson?: string | null },
  ): string {
    return ensureNodeLabel(this.ctx(op), input);
  }

  insertNodeLabelAssignment(
    op: MemoryOpContext,
    input: { nodeId: string; labelId: string; props: Record<string, unknown> },
  ): void {
    insertNodeLabelAssignment(this.ctx(op), input);
  }

  findMemoryIdByKey(namespace: string, key: string): string | undefined {
    return findMemoryIdByKey(this.readCtx(), namespace, key);
  }

  nodeExists(nodeId: string): boolean {
    return nodeExists(this.readCtx(), nodeId);
  }

  insertEdge(
    op: MemoryOpContext,
    input: {
      fromNodeId: string;
      toNodeId: string;
      properties?: Record<string, unknown>;
      idParts: { label: string; fromMemoryId: string; toMemoryId: string };
    },
  ): { edgeId: string } {
    return insertEdge(this.ctx(op), input);
  }

  ensureEdgeLabel(
    op: MemoryOpContext,
    input: { kind: string; description?: string; schemaJson?: string | null },
  ): string {
    return ensureEdgeLabel(this.ctx(op), input);
  }

  insertEdgeLabelAssignment(
    op: MemoryOpContext,
    input: { edgeId: string; labelId: string; props: Record<string, unknown> },
  ): void {
    insertEdgeLabelAssignment(this.ctx(op), input);
  }

  syncMemorySearchMeta(
    op: MemoryOpContext,
    input: { namespace: string; memoryKey: string; metaVector?: Float32Array },
  ): void {
    syncMemorySearchMeta(this.ctx(op), input);
  }

  syncLabelPropsSearchFeatures(
    op: MemoryOpContext,
    input: { namespace: string; memoryKey: string },
  ): void {
    syncLabelPropsSearchFeaturesImpl(this.ctx(op), {
      ...input,
      formatLabelProps: this.labelPropsSearchFormatter,
    });
  }

  buildCanonicalMemorySearchMetaText(
    op: MemoryOpContext,
    namespace: string,
    memoryKey: string,
  ): string {
    return buildCanonicalMemorySearchMetaText(this.ctx(op), namespace, memoryKey);
  }

  upsertMemorySearchMetaVector(
    op: MemoryOpContext,
    input: { namespace: string; memoryKey: string; vector: Float32Array },
  ): void {
    upsertMemorySearchMetaVector(this.ctx(op), input);
  }

  deleteMemoryRootRows(
    input:
      | { memoryKind: "node"; memoryId: string; nodeId: string }
      | { memoryKind: "edge"; edgeId: string },
  ): void {
    if (input.memoryKind === "node") {
      this.stmts.deleteMemoryById.run(input.memoryId);
      this.stmts.deleteNodeById.run(input.nodeId);
      return;
    }
    /** With `edge_id` FK ON DELETE CASCADE, removing the edge removes the edge-attached memory row. */
    this.stmts.deleteEdgeById.run(input.edgeId);
  }

  isMemorySuppressed(memoryId: string): boolean {
    return isMemorySuppressedRow(this.readCtx(), memoryId);
  }

  setMemorySuppressed(op: MemoryOpContext, input: { memoryId: string; suppressed: boolean }): void {
    setMemorySuppressedRow(this.ctx(op), input);
  }

  isNamespaceSuppressed(namespace: string): boolean {
    return isNamespaceSuppressedQuery(this.db, namespace);
  }

  findClosestSuppressedNamespace(namespace: string): string | null {
    return findClosestSuppressedNamespaceQuery(this.db, namespace);
  }

  setNamespaceSuppressed(
    op: MemoryOpContext,
    input: { namespace: string; suppressed: boolean },
  ): void {
    setNamespaceSuppressedQuery(this.db, op, input);
  }

  searchLexicalSourceMapIds(input: {
    scope: SearchNamespaceScope;
    text: string;
    limit: number;
    memoryIds?: string[];
    asOf?: SearchAsOf;
    includeSuppressed?: boolean;
  }): string[] {
    return searchLexicalSourceMapIds(this.readCtx(), input);
  }

  searchVectorSourceMapIds(input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOf?: SearchAsOf;
    method: "knn" | "ann";
    includeSuppressed?: boolean;
  }): { sourceMapIds: string[]; vectorSearchMethod?: "knn" | "ann" } {
    if (input.method === "ann" && !this.capabilities.vectorAnnSearch) {
      return { sourceMapIds: [] };
    }
    if (input.method === "knn" && !this.capabilities.vectorKnnSearch) {
      return { sourceMapIds: [] };
    }
    return searchVectorSourceMapIds(this.readCtx(), input);
  }

  hydrateSourceMapHits(sourceMapIds: readonly string[]) {
    return hydrateSourceMapHits(this.readCtx(), sourceMapIds);
  }

  listNeighborsForMemory<
    EDGE_LABEL extends string = string,
    NODE_LABEL extends string = string,
  >(input: {
    namespace: string;
    key: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
    includeSuppressed?: boolean;
  }): HydratedNeighbor[] {
    return listNeighborsForMemory<EDGE_LABEL, NODE_LABEL>(this.readCtx(), input);
  }

  listNeighborsForEdgeMemory<
    EDGE_LABEL extends string = string,
    NODE_LABEL extends string = string,
  >(input: {
    namespace: string;
    edgeId: string;
    filters?: NeighborFilter<EDGE_LABEL, NODE_LABEL>;
    includeSuppressed?: boolean;
  }): HydratedNeighbor[] {
    return listNeighborsForEdgeMemory<EDGE_LABEL, NODE_LABEL>(this.readCtx(), input);
  }

  listMemoryNamespaces(): string[] {
    return listMemoryNamespacesQuery(this.db);
  }

  listNamespacesWithMetadata(opts?: { includeSuppressed?: boolean }): NamespaceMetadataInfo[] {
    return listNamespacesWithMetadataQuery(this.db, opts);
  }

  listNamespacesWithMetadataUnderPrefix(
    prefix: string,
    opts?: { includeSuppressed?: boolean },
  ): NamespaceMetadataInfo[] {
    return listNamespacesWithMetadataUnderPrefixQuery(this.db, prefix, opts);
  }

  namespaceExistsUnderPrefix(prefix: string, opts?: { includeSuppressed?: boolean }): boolean {
    return namespaceExistsUnderPrefixQuery(this.db, prefix, opts);
  }

  getNamespaceMetadata(namespace: string): NamespaceMetadataInfo | undefined {
    return getNamespaceMetadataQuery(this.db, namespace);
  }

  listMemoryKeysInNamespace(namespace: string): string[] {
    return listMemoryKeysInNamespaceQuery(this.db, namespace);
  }

  listSourceMapsForMemory(memoryId: string, limit: number): SourceMap[] {
    return listSourceMapsForMemoryQuery(this.readCtx(), memoryId, limit);
  }

  listSourceMapInventoryForMemory(memoryId: string, limit: number) {
    return listSourceMapInventoryForMemoryQuery(this.readCtx(), memoryId, limit);
  }

  listTextFeatureExportRowsForMemory(memoryId: string): TextFeatureExportRow[] {
    return listTextFeatureExportRowsForMemoryQuery(this.readCtx(), memoryId);
  }

  getSourceMapTextPreview(sourceMapId: string, maxChars = 8000): string | null {
    const joined = this.getSourceMapText(sourceMapId);
    if (joined === null) return null;
    if (joined.length <= maxChars) return joined;
    return `${joined.slice(0, Math.max(0, maxChars - 1))}…`;
  }

  getSourceMapText(sourceMapId: string): string | null {
    const rows = this.db
      .query<{ text: string }, [string]>(
        `SELECT tf.text AS text
         FROM text_features tf
         WHERE tf.source_map_id = ?
         ORDER BY tf._ts_created ASC, tf._id ASC`,
      )
      .all(sourceMapId);
    if (rows.length === 0) return null;
    return rows.map((row) => row.text).join("\n\n");
  }

  listVectorEmbeddingIndexDimensions(): number[] {
    return listVectorEmbeddingIndexDimensionsQuery(this.db);
  }

  listProvenanceEvents(input: {
    namespace?: string;
    key?: string;
    limit: number;
    before?: { createdAt: number; id: string };
  }) {
    return listProvenanceEventsQuery(this.db, input);
  }

  listProvenanceChain(input: { limit: number; beforeRootHex?: string }) {
    return listProvenanceChainQuery(this.db, input);
  }

  loadGraphEdgesForNamespace(
    namespace: string,
    opts?: { includeSuppressed?: boolean },
  ): GraphEdgeLink[] {
    if (!this.capabilities.graphIndex) return [];
    return loadGraphEdgesQuery(this.db, namespace, opts);
  }

  loadNodeLabelsForNamespace(namespace: string, opts?: { includeSuppressed?: boolean }) {
    if (!this.capabilities.graphIndex) return new Map();
    return loadNodeLabelsQuery(this.db, namespace, opts);
  }

  loadNodePropertiesForNamespace(
    namespace: string,
    opts?: { includeSuppressed?: boolean },
  ): Map<string, Record<string, unknown> | null> {
    if (!this.capabilities.graphIndex) return new Map();
    return loadNodePropertiesQuery(this.db, namespace, opts);
  }

  listIncidentGraphEdges(
    namespace: string,
    memoryKey: string,
    opts?: { includeSuppressed?: boolean },
  ): GraphEdgeLink[] {
    if (!this.capabilities.graphIndex) return [];
    return listIncidentGraphEdgesQuery(this.db, namespace, memoryKey, opts);
  }

  loadNodeLabelsForMemory(namespace: string, memoryKey: string) {
    if (!this.capabilities.graphIndex) return [];
    return loadNodeLabelsForMemoryQuery(this.db, namespace, memoryKey);
  }

  loadNodePropertiesForMemory(
    namespace: string,
    memoryKey: string,
  ): Record<string, unknown> | null {
    if (!this.capabilities.graphIndex) return null;
    return loadNodePropertiesForMemoryQuery(this.db, namespace, memoryKey);
  }

  loadGraphEdge(
    namespace: string,
    edgeId: string,
    opts?: { includeSuppressed?: boolean },
  ): GraphEdgeLink | null {
    if (!this.capabilities.graphIndex) return null;
    return loadGraphEdgeQuery(this.db, namespace, edgeId, opts);
  }

  loadGraphNode(
    namespace: string,
    memoryKey: string,
    opts?: { includeSuppressed?: boolean },
  ): GraphNode | null {
    if (!this.capabilities.graphIndex) return null;
    return loadGraphNodeQuery(this.db, namespace, memoryKey, opts);
  }

  listSuppressedNodeKeysForNamespace(namespace: string): string[] {
    if (!this.capabilities.graphIndex) return [];
    return listSuppressedNodeKeysForNamespaceQuery(this.db, namespace);
  }

  countGraphForNamespace(
    namespace: string,
    opts?: { includeSuppressed?: boolean },
  ): GraphNamespaceCounts {
    if (!this.capabilities.graphIndex) return { nodeCount: 0, edgeCount: 0 };
    return countGraphForNamespaceQuery(this.db, namespace, opts);
  }

  statsGraphForNamespace(
    namespace: string,
    opts?: { includeSuppressed?: boolean },
  ): GraphNamespaceStats {
    if (!this.capabilities.graphIndex) {
      return {
        nodeCount: 0,
        edgeCount: 0,
        suppressedNodeCount: 0,
        suppressedEdgeCount: 0,
        labelKinds: { nodes: {}, edges: {} },
      };
    }
    return statsGraphForNamespaceQuery(this.db, namespace, opts);
  }

  /** Underlying Bun SQLite handle (host-owned; do not close from callers). */
  getDatabase(): Database {
    return this.db;
  }
}

/** Resolve the SQLite `Database` from a host persistence instance. */
export function getMemoriesSqliteDatabase(persistence: IMemoriesPersistence): Database {
  if (persistence instanceof MemoriesPersistence) {
    return persistence.getDatabase();
  }
  throw new Error("getMemoriesSqliteDatabase: expected SQLite MemoriesPersistence");
}

export function createMemoriesPersistence(
  db: Database,
  options?: {
    labelPropsSearchFormatter?: LabelPropsSearchFormatter;
    namespacePathPolicy?: NamespacePathPolicy;
    /** Newest provenance tips whose blob bodies stay hot (default 256; `0` = never evacuate). */
    contentOutboxRetentionTips?: number;
    /** When set, bodies outside the hot window go here; when omitted, they are permanently dropped. */
    contentBlobColdStore?: ContentBlobColdStore;
    /**
     * Bun S3 cold-store factory options. Used when `contentBlobColdStore` is omitted.
     * Pass `false` to skip auto-detecting env (`S3_BUCKET` / `AWS_BUCKET`).
     */
    bunS3ColdStore?: BunS3ContentBlobColdStoreOptions | false;
  },
): MemoriesPersistence {
  const coldStore =
    options?.contentBlobColdStore ??
    (options?.bunS3ColdStore === false
      ? undefined
      : createBunS3ContentBlobColdStore(
          options?.bunS3ColdStore === undefined ? undefined : options.bunS3ColdStore,
        ));
  const persistence = new MemoriesPersistence(
    db,
    options?.labelPropsSearchFormatter,
    options?.namespacePathPolicy,
    options?.contentOutboxRetentionTips,
    coldStore,
  );
  return persistence;
}
