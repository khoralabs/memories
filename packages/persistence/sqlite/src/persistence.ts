import type { Database } from "bun:sqlite";
import type {
  GraphEdgeLink,
  GraphNode,
  MemoriesPersistence as IMemoriesPersistence,
  LabelPropsSearchFormatter,
  MemoriesBackendCapabilities,
  MemoryOpContext,
  NeighborFilter,
  SearchNamespaceScope,
} from "@khoralabs/memories-core";
import type { SourceMap, TextFeatureExportRow } from "@khoralabs/memories-core/persistence";
import type { MemoryProvenanceEvent } from "@khoralabs/memories-core/provenance";
import {
  appendDeleteOutboxEntry,
  appendMergeOutboxEntries,
  type ContentAtRootHit,
  getMemoryContentAtRootHex as getMemoryContentAtRootHexQuery,
  reconstructStoreAtRootHex as reconstructStoreAtRootHexQuery,
} from "./models/content-outbox";
import type { DbCtx } from "./models/context";
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
  loadMemoryNamespaceKey as loadMemoryNamespaceKeyRow,
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
import { type MemoriesSqliteStmts, prepareMemoriesSqliteStmts } from "./models/prepared-stmts";
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

export class MemoriesPersistence implements IMemoriesPersistence {
  readonly capabilities: MemoriesBackendCapabilities = {
    lexicalSearch: true,
    vectorSearch: true,
    neighborIndex: true,
    graphIndex: true,
    multiNamespaceSearch: true,
    unscopedSearch: true,
    asOfTimestampMsSearch: true,
  };

  private readonly stmts: MemoriesSqliteStmts;

  constructor(
    private readonly db: Database,
    private readonly labelPropsSearchFormatter?: LabelPropsSearchFormatter,
  ) {
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
  }

  /** Reconstruct the text content of one memory as of the given provenance chain link. */
  getMemoryContentAtRootHex(
    rootHex: string,
    namespace: string,
    memoryKey: string,
  ): ContentAtRootHit[] {
    return getMemoryContentAtRootHexQuery(this.db, rootHex, namespace, memoryKey);
  }

  /**
   * Reconstruct the text content of every memory in the store as of the given chain link.
   * Scans the full outbox — use {@link getMemoryContentAtRootHex} for single-key lookups.
   */
  reconstructStoreAtRootHex(rootHex: string): ContentAtRootHit[] {
    return reconstructStoreAtRootHexQuery(this.db, rootHex);
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

  searchLexicalSourceMapIds(input: {
    scope: SearchNamespaceScope;
    text: string;
    limit: number;
    memoryIds?: string[];
    asOfTimestampMs?: number;
  }): string[] {
    return searchLexicalSourceMapIds(this.readCtx(), input);
  }

  searchVectorSourceMapIds(input: {
    scope: SearchNamespaceScope;
    vector: number[];
    limit: number;
    memoryIds?: string[];
    maxVectorDistance?: number;
    asOfTimestampMs?: number;
  }): string[] {
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
  }): HydratedNeighbor[] {
    return listNeighborsForEdgeMemory<EDGE_LABEL, NODE_LABEL>(this.readCtx(), input);
  }

  listSourceMapsForMemory(memoryId: string, limit: number): SourceMap[] {
    return listSourceMapsForMemoryQuery(this.readCtx(), memoryId, limit);
  }

  listTextFeatureExportRowsForMemory(memoryId: string): TextFeatureExportRow[] {
    return listTextFeatureExportRowsForMemoryQuery(this.readCtx(), memoryId);
  }

  listVectorEmbeddingIndexDimensions(): number[] {
    return listVectorEmbeddingIndexDimensionsQuery(this.db);
  }

  loadGraphEdgesForNamespace(namespace: string): GraphEdgeLink[] {
    if (!this.capabilities.graphIndex) return [];
    return loadGraphEdgesQuery(this.db, namespace);
  }

  loadNodeLabelsForNamespace(namespace: string) {
    if (!this.capabilities.graphIndex) return new Map();
    return loadNodeLabelsQuery(this.db, namespace);
  }

  loadNodePropertiesForNamespace(namespace: string): Map<string, Record<string, unknown> | null> {
    if (!this.capabilities.graphIndex) return new Map();
    return loadNodePropertiesQuery(this.db, namespace);
  }

  listIncidentGraphEdges(namespace: string, memoryKey: string): GraphEdgeLink[] {
    if (!this.capabilities.graphIndex) return [];
    return listIncidentGraphEdgesQuery(this.db, namespace, memoryKey);
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

  loadGraphEdge(namespace: string, edgeId: string): GraphEdgeLink | null {
    if (!this.capabilities.graphIndex) return null;
    return loadGraphEdgeQuery(this.db, namespace, edgeId);
  }

  loadGraphNode(namespace: string, memoryKey: string): GraphNode | null {
    if (!this.capabilities.graphIndex) return null;
    return loadGraphNodeQuery(this.db, namespace, memoryKey);
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
  options?: { labelPropsSearchFormatter?: LabelPropsSearchFormatter },
): MemoriesPersistence {
  return new MemoriesPersistence(db, options?.labelPropsSearchFormatter);
}
