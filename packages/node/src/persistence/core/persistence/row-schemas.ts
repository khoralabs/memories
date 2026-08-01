import type { ContentHash, SourceRef } from "@khoralabs/sourcemaps";
import z from "zod";
import { MEMORY_NAMESPACE_PATH_REGEX } from "../models/namespace-path";
import { defineSchema, zId } from "./define-schema";

/** Lowercase SHA-256 hex digest (64 chars, no `0x`). */
export const zSha256HexLower = z.string().regex(/^[0-9a-f]{64}$/);

/** Root memory: indexed content attached to a primary graph node, or to a single graph edge. */
export const zMemoryKind = z.enum(["node", "edge"]);
export type MemoryKind = z.infer<typeof zMemoryKind>;

/**
 * A memory is a collection of features with tightly shared semantics.
 * `kind: edge` rows reference exactly one `edges` row via `edge_id` (no primary `nodes` row for `key`).
 */
export const zMemory = z.object({
  namespace: z.string().regex(MEMORY_NAMESPACE_PATH_REGEX).max(128),
  key: z.string(),
  kind: zMemoryKind,
  /** Set when `kind` is `edge`; unique per non-null value. */
  edge_id: zId("edges").optional(),
  /** `1` when hidden from search/graph discovery; rows remain. */
  suppressed: z.union([z.literal(0), z.literal(1)]).optional(),
});

/**
 * One memory may have many sourcemaps; one for each feature
 * Each vector feature and text feature has one sourcemap
 */
export const zSourceMap = z.object({
  memory_id: zId("memories"),
  source_key: z.string(),
  /** Content-addressable body digest; see `../provenance/index`. */
  content_hash: zSha256HexLower.optional(),
});

/**
 * Linear causal chain over merge/delete mutations (hash rules in `../provenance/index`).
 */
export const zMemoryProvenance = z.object({
  parent_root_hex: zSha256HexLower,
  root_hex: zSha256HexLower,
  /** `MERGE_MEMORY` | `DELETE_MEMORY` | `SUPPRESS_MEMORY` | `UNSUPPRESS_MEMORY` | `RENAME_NAMESPACE`. */
  event_type: z.string(),
  event_json: z.string(),
  intent_snapshot_id: z.string().optional(),
});

/**
 * Plaintext chunks have one text feature
 * Text files have n text features; one for each text chunk
 * Binary files have no text features
 */
export const zTextFeature = z.object({
  memory_id: zId("memories"),
  source_map_id: zId("source_maps"),
  text: z.string(),
});

/** Embedding vector payload: same dimension bounds as `vector_features.vector`. */
export const zVectorPayload = z.array(z.float32()).min(512).max(3072);

/**
 * Plaintext chunks have one vector feature
 * Text files have n vector features; one for each text chunk
 * Binary files have one vector feature
 */
export const zVectorFeature = z.object({
  memory_id: zId("memories"),
  source_map_id: zId("source_maps"),
  vector: zVectorPayload,
});

/**
 * Ontological catalog: one row per node label **kind**
 */
export const zNodeLabel = z.object({
  kind: z.string(),
  description: z.string(),
  /** JSON Schema (Draft 2020-12) text for assignment `props`, or null. */
  schema: z.string().nullable(),
});

/**
 * Ontological catalog: one row per edge label **kind**
 */
export const zEdgeLabel = z.object({
  kind: z.string(),
  description: z.string(),
  schema: z.string().nullable(),
});

/**
 * Instance: at most one row per (edge_id, label_id)
 */
export const zEdgeLabelAssignment = z.object({
  edge_id: zId("edges"),
  label_id: zId("edge_labels"),
  props: z.record(z.string(), z.unknown()),
});

/**
 * Instance: at most one row per (node_id, label_id)
 */
export const zNodeLabelAssignment = z.object({
  node_id: zId("nodes"),
  label_id: zId("node_labels"),
  props: z.record(z.string(), z.unknown()),
});

/** Scope identifier for DAG visibility (same path syntax as {@link MEMORY_NAMESPACE_PATH_REGEX}). */
export const zScopePath = z.string().regex(MEMORY_NAMESPACE_PATH_REGEX).max(128);

/**
 * Each primary graph node rows links to exactly one memory row.
 */
/** `memory_id` matches `memories._id` logically; stored as plain TEXT to avoid FK cycles (`memories` ↔ `nodes` via `edges`). */
export const zNode = z.object({
  memory_id: z.string().min(1),
  value: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/** Registered scope node (id = scope path string). */
export const zScopes = z.object({});

/**
 * Optional display metadata for a memory namespace path (`_id` = namespace key).
 * `display_name` null means UI should use the path key.
 */
export const zNamespaceMetadata = z.object({
  display_name: z.string().nullable(),
  description: z.string(),
  _ts_updated: z.number().nonnegative(),
});

/** Directed scope edge: parent scope strictly above child in the DAG. */
export const zScopeEdges = z.object({
  parent_scope_id: zId("scopes"),
  child_scope_id: zId("scopes"),
});

/** Transitive closure: ancestor can reach descendant via zero or more scope edges. */
export const zScopeClosure = z.object({
  ancestor_scope_id: zId("scopes"),
  descendant_scope_id: zId("scopes"),
});

/** Memory visibility under one or more scopes (DAG search expands roots via {@link zScopeClosure}). */
export const zMemoryScopes = z.object({
  memory_id: zId("memories"),
  scope_id: zId("scopes"),
});

/**
 * Each node has many edges to provide structural links between it and other memories
 */
export const zEdge = z.object({
  from_node_id: zId("nodes"),
  to_node_id: zId("nodes"),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Canonical composed document schema for the memories persistence relational model.
 */
export const memoriesPersistenceDocumentSchema = defineSchema({
  memory_provenance: zMemoryProvenance,
  source_maps: zSourceMap,
  memories: zMemory,
  text_features: zTextFeature,
  vector_features: zVectorFeature,
  scopes: zScopes,
  namespace_metadata: zNamespaceMetadata,
  scope_edges: zScopeEdges,
  scope_closure: zScopeClosure,
  memory_scopes: zMemoryScopes,
  nodes: zNode,
  edges: zEdge,
  node_labels: zNodeLabel,
  edge_labels: zEdgeLabel,
  node_label_assignments: zNodeLabelAssignment,
  edge_label_assignments: zEdgeLabelAssignment,
});

/** Denormalized row for JSONL export / prefetch (join of text_features + source_maps). */
export const zTextFeatureExportRow = z.object({
  memory_id: zId("memories"),
  source_key: z.string(),
  text: z.string(),
});

export type MemoriesPersistenceSchema = z.infer<typeof memoriesPersistenceDocumentSchema>;

export type Memory = MemoriesPersistenceSchema["memories"];
export type MemoryProvenance = MemoriesPersistenceSchema["memory_provenance"];

export type SourceMapLocators = { memory_id: string; source_key: string };
/** Address ref for resolve / provenance (not the full persisted row). */
export type SourceMap = SourceRef<SourceMapLocators> & { content_hash?: ContentHash };
/** Persisted `source_maps` table row (`_id`, `_ts_created`, locators, optional hash). */
export type SourceMapRow = MemoriesPersistenceSchema["source_maps"];
export type TextFeature = MemoriesPersistenceSchema["text_features"];
export type VectorFeature = MemoriesPersistenceSchema["vector_features"];
export type Node = MemoriesPersistenceSchema["nodes"];
export type ScopeClosureRow = MemoriesPersistenceSchema["scope_closure"];
export type MemoryScopeRow = MemoriesPersistenceSchema["memory_scopes"];
export type NamespaceMetadataRow = MemoriesPersistenceSchema["namespace_metadata"];
export type Edge = MemoriesPersistenceSchema["edges"];
export type NodeLabel = MemoriesPersistenceSchema["node_labels"];
export type EdgeLabel = MemoriesPersistenceSchema["edge_labels"];
export type NodeLabelAssignment = MemoriesPersistenceSchema["node_label_assignments"];
export type EdgeLabelAssignment = MemoriesPersistenceSchema["edge_label_assignments"];

export type TextFeatureExportRow = z.infer<typeof zTextFeatureExportRow>;
