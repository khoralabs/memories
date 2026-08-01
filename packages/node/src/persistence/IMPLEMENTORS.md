# Memory persistence implementor’s guide

This document describes the **operational contract** for [`MemoriesPersistence`](./core/persistence/types.ts). Method names and storage types live in `@khoralabs/memories-node`; behavior and ordering are specified here.

## Layout in this package

| Path | Role | Public export |
| ---- | ---- | ------------- |
| [`./core`](./core) | Shared types, Zod row schemas, ID helpers, provenance hashing, search-meta facade | `@khoralabs/memories-node/persistence`, `@khoralabs/memories-node/provenance` |
| [`./sqlite`](./sqlite) | Reference **sync** (Bun `bun:sqlite`) + async wrapper; schema/migrations; graph projections | `@khoralabs/memories-node/sqlite` |
| [`./libsql`](./libsql) | **Async** libSQL client backend; schema/migrations; graph projections | `@khoralabs/memories-node/libsql` |
| [`./turso-serverless`](./turso-serverless) | **Async** Turso serverless backend; schema/migrations (no projection helpers yet) | `@khoralabs/memories-node/turso-serverless` |
| [`./testing`](./testing) | Shared persistence + projections contract suites | `@khoralabs/memories-node/testing` |

The reference SQLite implementation is [`./sqlite/persistence/persistence.ts`](./sqlite/persistence/persistence.ts) (`createMemoriesPersistence`). Async factories: `createMemoriesPersistenceAsync` (SQLite), `createMemoriesLibsqlPersistence`, `createMemoriesTursoServerlessPersistence`. The wire model is also described in [`packages/spec`](../../../spec/model/persistence.smithy) (Smithy).

## Relational row shapes (Zod)

Canonical **table Zod schemas**, the composed document schema (`memoriesPersistenceDocumentSchema`), **row TypeScript types** (via `MemoriesPersistenceSchema`), helpers (`zId`, `defineSchema`, `documentValidator`), and **vector payload** rules (`zVectorPayload`, 512–3072 floats) live in **`@khoralabs/memories-node/persistence`** ([`./core/persistence`](./core/persistence)).

The reference SQLite strategy defines on-disk tables in [`./sqlite/persistence/schema.ts`](./sqlite/persistence/schema.ts) and applies them via [`./sqlite/persistence/migrations/`](./sqlite/persistence/migrations/); libSQL and Turso mirror the same logical schema in their own `schema.ts` / `migrations` modules. Insert-time `documentValidator` checks use persistence core for type alignment. TypeScript backends should import from `@khoralabs/memories-node/persistence` so storage rows and merge-time validation stay aligned with `mergeMemory` / `MemoriesPersistence`.

## Smithy capability modules

[`persistence.smithy`](../../../spec/model/persistence.smithy) defines **module** services (subsets of operations) plus a single aggregate **`MemoriesPersistenceService`** with the full operation list. Use modules to see what a minimal backend can omit; use the aggregate for a “full adapter” contract or codegen.

| Smithy service | Role | TypeScript (approx.) | When omitted / `MemoriesBackendCapabilities` |
| ---------------- | ---- | -------------------- | --------------------------------------------- |
| `MemoriesPersistenceCore` | Lexical mutation, catalog, edges, search-meta text path, lexical search, hydrate | [`MemoriesMutation`](./core/persistence/types.ts) (minus vector + optional label-props sync) + lexical half of [`MemoriesRetrieval`](./core/persistence/types.ts) | Baseline for any storage implementation. |
| `MemoriesPersistenceVector` | Vector features, meta-vector upsert, vector search, embedding dimensions | Vector methods on mutation/retrieval + `listVectorEmbeddingIndexDimensions` | Omit when `vectorSearch` is `false`. |
| `MemoriesPersistenceNeighbors` | Neighbor listing for search | [`MemoriesNeighborIndex`](./core/persistence/types.ts) | Omit when `neighborIndex` is `false`. |
| `MemoriesPersistenceLabelProps` | `SyncLabelPropsSearchFeatures` | Optional `syncLabelPropsSearchFeatures?` on mutation | Omit if label-props search chunks are unsupported. |
| `MemoriesPersistenceReads` | Prefetch / export reads | [`MemoriesPersistenceReads`](./core/persistence/types.ts) except `listVectorEmbeddingIndexDimensions` (that method is grouped under **Vector** in Smithy) | Thin stores may skip; most backends implement with Core. |
| *(graph topology)* | Namespace edge lists, node labels/properties, incident edges; per-memory labels/properties; load edge by id; load full graph node; node/edge label writes | [`MemoriesGraph`](./core/persistence/types.ts) = [`MemoriesGraphIndex`](./core/persistence/types.ts) + [`MemoriesGraphMutation`](./core/persistence/types.ts) on [`MemoriesPersistence`](./core/persistence/types.ts) | Reads return empty when `graphIndex` is `false`. Per-entity reads: `loadNodeLabelsForMemory`, `loadNodePropertiesForMemory`, `loadGraphEdge`, [`loadGraphNode`](./core/persistence/types.ts). |

**`loadGraphNode`** is the preferred single-call read for one memory’s graph node (labels, parsed `nodes.properties`, and stable `nodeId`). The split helpers `loadNodeLabelsForMemory` / `loadNodePropertiesForMemory` remain for narrow call sites that only need one piece.

Graph topology is part of **`MemoriesPersistence`** (not a separate core interface). UMAP layout inputs and text/edge previews are backend projection helpers; see [Graph projections (optional)](#graph-projections-optional) below.

## ID conventions

Stable string primary keys are derived in [`./core/models/ids.ts`](./core/models/ids.ts). The logic layer uses:

- `ids.memory(namespace, key)` and `ids.node(namespace, key)` for the primary memory row and its graph node.
- `ids.nodeLabel(kind)` / `ids.edgeLabel(kind)` hash the **catalog kind string only** (not assignment props).
- `ids.nodeLabelAssignment(nodeId, labelId)` and `ids.edgeLabelAssignment(edgeId, labelId)` are stable under **one assignment row per (node, label)** and **(edge, label)**.

Implementations must use the same derivation if they need to match the reference store.

## Ontology labels: catalog vs assignments

- **Catalog** (`node_labels`, `edge_labels`): one row per **label kind**. Columns: **`kind`**, **`description`**, optional **`schema`** (JSON text: JSON Schema for that kind’s `props`, often exported from Zod via `z.toJSONSchema()`).
- **Assignments** (`node_label_assignments`, `edge_label_assignments`): one row per **(entity, catalog label)**; store **`props`** as JSON (object). Upserts replace props on re-merge.

Merge callers pass structured `{ kind, props }` (see [`MergeMemoryParams`](../core/api/merge-memory.ts)); the reference stores **optionally** validate `props` with **Ajv** against the catalog `schema` when `schema` is non-null (root `$schema` from Zod is stripped before compile—see each backend’s `models/validate-props.ts`).

## Transactions: `withTransaction`

- **Purpose:** All merge and delete mutations run inside a single transaction.
- **Reference (SQLite):** Implemented as `db.transaction(fn)()`. On uncaught exception, SQLite rolls back the transaction.
- **libSQL / Turso:** Async `withTransaction`; nested calls throw `NestedTransactionError`.
- **Nested calls:** Avoid nesting `withTransaction` unless your driver documents safe re-entrancy; the reference path does not nest.
- **Async / remote:** For backends that need asynchronous commits, see [`MemoriesPersistenceAsync`](./core/persistence/async-types.ts) and async entry points (`mergeMemoryAsync`, `searchAsync`, `deleteMemoryAsync`, `MemoriesClientAsync`).

## `clearMemorySubtree` vs `deleteMemoryRootRows`

- **`clearMemorySubtree`:** Removes dependent data for a memory (source maps, text/vector features, FTS rows, vector index rows, label assignments, search-meta rows, **`memory_scopes`** rows, etc.). **Node** memories also delete incident **edges** (and any **edge-attached** `memories` rows whose `edge_id` references those edges). **Edge** memories clear indexed features and edge label assignments for that edge without deleting neighbor nodes’ topology beyond what edge deletion implies.
- **`deleteMemoryRootRows`:** For **node** memories, deletes the root `memories` and `nodes` rows. For **edge** memories, deletes the owning memory row and the **`edges`** row (same merge identity).
- **Idempotency:** `deleteMemory` should be safe if the memory was already absent (reference clears then deletes roots).

## Content: source maps and features

- One **source map** per merge content item `key` (user `source_key`).
- **Text:** `insertLexicalFeature` ties searchable text to that source map; lexical search returns `source_map` ids.
- **Vector:** `insertVectorFeature` stores a `Float32Array`; **query vectors in search must use the same dimensionality** as stored vectors for the vector arm to return hits.
- If `MemoriesBackendCapabilities.vectorSearch` is `false`, the logic layer rejects merge items that include `vector` and skips the vector search arm (see capabilities below).

## Memory provenance chain + `source_maps.content_hash`

- **`memory_provenance`:** Append-only linear chain over **merge**, **delete**, **suppress** / **unsuppress**, and **rename**. Each row stores `parent_root_hex`, `root_hex`, `event_type`, canonical **`event_json`**, and optional `intent_snapshot_id`. The head is the latest `root_hex` by `_ts_created` (then `_id`). **Genesis parent** for the first link is the fixed 32-byte zero pattern (`00…00` hex), not SQL `NULL`.
- **Leaf + link:** Implemented in `@khoralabs/memories-node/provenance` ([`./core/provenance`](./core/provenance)): event leaf `SHA-256(MEMORIES_EVENT_LEAF_v1 || NUL || UTF-8(canonical_json(event)))`; chain link `SHA-256(parent_32 || leaf_32)` with parent decoded from lowercase hex (or zero bytes at genesis).
- **`mergeMemory` / `deleteMemory`:** After successful KG mutations in one transaction, **`appendProvenanceEvent`** records **`MERGE_MEMORY`** or **`DELETE_MEMORY`** respectively. **Idempotent delete:** if the memory row is already absent, **do not** append a provenance row (avoids duplicate-delete spam).
- **`suppressMemory` / `unsuppressMemory`:** Soft-hide without deleting rows. Sets materialized `memories.suppressed` and appends **`SUPPRESS_MEMORY`** / **`UNSUPPRESS_MEMORY`**. Idempotent when already in the target state (no tip advance). Discovery (search, neighbors, graph layout) excludes suppressed memories and edge memories incident to a suppressed node; load-by-key still works. Does **not** write the content outbox (PIT reconstruction stays content-intact).
- **Contributor attribution:** `MemoryOpContext.contributor` is optional. When present, core includes the signed contributor envelope in `event_json`; storage implementations do not verify it, but must store the canonical event unchanged so the attribution is part of the hash chain. `MemoryOpContext.intentSnapshotId` is optional; when present, core includes `intent_snapshot_id` in the event and persistence stores the same value in the query-friendly `memory_provenance.intent_snapshot_id` column.
- **`content_hash`:** Nullable column on **`source_maps`**, lowercase 64-char hex. After inserting text and/or vector features for that map, **`updateSourceMapContentHash`** sets `SHA-256(MEMORIES_SOURCE_BODY_v1 || NUL || UTF-8(canonical_json(descriptor)))` where the descriptor references `text_sha256` / `vector_sha256` of the materialized payloads (see `computeSourceMapContentHash` in persistence core). Merge provenance events may include optional **`content_hashes`** keyed by `source_key` for audit without re-reading blobs.
- **Rollbacks:** Provenance and content-hash writes participate in the same **`withTransaction`** boundary as merge/delete; a failing append rolls back the whole mutation.

### Future (out of scope here)

Verkle trees, sparse Merkle non-membership proofs, and ZK reasoning over the KG are not part of this schema; only the linear mutation log + per-map digests are specified today.

## Edges

- **`insertEdge`:** `idParts.label` is the **edge label kind** (string); **`fromMemoryId`** / **`toMemoryId`** are the endpoint memories’ stable ids (`ids.memory(...)`). `ids.edge(fromNodeId, toNodeId, label, fromMemoryId, toMemoryId)` dedupes the directed link. Endpoints may live in **different primary namespaces**.
- After inserting an edge, callers **`ensureEdgeLabel`** (catalog) then **`insertEdgeLabelAssignment`** with **`props`** for that kind on that edge.

## DAG scopes (search visibility)

- **Tables:** `scopes`, `scope_edges`, `scope_closure`, `memory_scopes` (see Zod `memoriesPersistenceDocumentSchema`). Scope ids reuse **`MemoryNamespace`** path syntax.
- **`linkScopes`:** inserts `parent → child`; **rejects cycles**. Reference impl rebuilds **`scope_closure`** (all `(ancestor, descendant)` pairs including self) after each link/unlink.
- **`replaceMemoryScopes`:** merge replaces attachments for the focal memory; **primary namespace is always included** alongside optional `attachScopes`.
- **Search:** `SearchNamespaceScope` adds **`scopeDag`** (roots expand through closure → attached memories) and **`exactScope`** (no descent). **`pathSubtree`** keeps prefix semantics on each row’s primary `memories.namespace` (strategy-private indexing; SQL backends use `namespace = ? OR namespace LIKE ? || '/%'`).

## Namespace metadata (alias / soft rename)

- **Table:** `namespace_metadata` (`_id` = namespace path, optional `display_name`, `description`, `_ts_created` / `_ts_updated`). Wire/API field is **`alias`** (maps to `display_name`); path remains identity.
- **`upsertNamespaceMetadata`:** may create metadata before any memories exist. Prefer `alias`; `displayName` accepted as deprecated synonym. `alias: null` means UI should show the path key.
- **`deleteNamespaceMetadata`:** remove one metadata row (idempotent if missing).
- **`listMemoryKeysInNamespace`:** keys for one primary namespace.
- **`listNamespacesWithMetadata`:** union of distinct `memories.namespace` and metadata keys (memory-only → `alias: null`, empty description).
- **`getNamespaceMetadata`:** single row or missing.
- Distinct from scope DAG metadata — keyed to primary memory namespaces, not `scopes` rows.
- **Namespace delete (core API):** `deleteNamespace` / `deleteNamespaceAsync` removes memories under a path (default recursive via prefix), then metadata rows. Uses per-memory `deleteMemory` provenance. Orphaned scope DAG rows may remain (best-effort; not required for correctness).
- **Literal path rename:** `renameNamespace` / `renameNamespacePaths` rematerializes memory/node/edge ids under a new path (destructive; separate from alias). One `RENAME_NAMESPACE` provenance event; history is not rewritten. Collisions on `(newNamespace, key)` fail. `maxNamespaces` applies only to net-new paths after the rewrite.

## Namespace path constraints

- Path grammar: 1..`NAMESPACE_MAX_DEPTH` (6) segments, `[a-z0-9_-]+`, max 128 chars. Violations throw **`NamespaceConstraintError`** (`invalid_path` | `max_depth`).
- Optional **max distinct namespaces** (memories ∪ metadata) is enforced by hosts/service (`maxNamespaces`); introducing a new path when at the cap throws `NamespaceConstraintError` with code `max_namespaces`.

## Search arms and ranking

- `searchLexicalSourceMapIds` returns an **ordered list** of `source_map` ids (best-first).
- `searchVectorSourceMapIds` takes a resolved **`method: "knn" | "ann"`** and returns `{ sourceMapIds; vectorSearchMethod? }`. Unsupported methods are a **noop** (`sourceMapIds: []`, no method). There is **no separate score contract**: `fuseRrf` in `@khoralabs/memories-node` (search API) uses **rank position** and configured arm weights only.
- Public `SearchParams.options.vectorSearchMethod` may be `"knn"`, `"ann"`, or omitted. Core resolves via [`resolveVectorSearchMethod`](./core/persistence/types.ts): explicit selection noops when the capability is off; omitted prefers **ANN then KNN**. `SearchOutput.vectorSearchMethod` reports the method that ran.
- **Namespace scope:** Both methods take **`scope: SearchNamespaceScope`**:
  - `{ kind: "pathSubtree"; namespaces }` — prefix match on primary **`memories.namespace`** (canonical overlapping roots; SQL: equality or `LIKE root || '/%'`).
  - `{ kind: "scopeDag"; roots }` — scope ids; match memories in **`memory_scopes`** whose scope is a **descendant** of some root in **`scope_closure`**.
  - `{ kind: "exactScope"; scopes }` — match attachments where **`scope_id`** is exactly one of the listed scope ids.
  - `{ kind: "unscoped" }` — entire DB (requires `unscopedSearch`).
- Optional **`memoryIds`** allowlist is **intersected** with scope predicates when both apply.
- **Hydration:** `hydrateSourceMapHits` expands ids to full [`HydratedSourceMapHit`](./core/models/neighbor-search-types.ts) rows: **`labels`** are node assignments when `graph` is **node**, edge assignments when `graph` is **edge**; **`graph`** discriminates attachment (`MemoryGraphAssociation`).

## Neighbors

- `listNeighborsForMemory` returns graph neighbors for a memory `key`, optionally filtered by [`NeighborFilter`](./core/models/neighbor-search-types.ts) (edge kinds, directions, node-label kinds on the neighbor). Neighbors may live in **any primary namespace** (`nodes.memory_id` → `memories`).
- Each row includes **`labels`** as structured instances and **`edge.label`** as a single `{ kind, props }` for the chosen incident edge label (when multiple kinds exist on one edge, the reference filters/picks per constraint).
- When `neighborIndex` capability is `false`, search **ignores** neighbor expansion (treats `neighbors` option as off).
- Neighbor **sub-search** reuses the same lexical/vector arms, scoped to neighbor memory ids.

## Backend capabilities

Optional property on the persistence object:

```ts
capabilities?: Partial<MemoriesBackendCapabilities>;
```

[`resolveMemoriesBackendCapabilities`](./core/persistence/types.ts) merges with [`DEFAULT_MEMORIES_BACKEND_CAPABILITIES`](./core/persistence/types.ts) (lexical, vector, neighbor, and multi-namespace search on; **unscoped** off; **`vectorKnnSearch` / `vectorAnnSearch` off** — backends must opt in). Set flags to declare MVP backends:

| Flag | When `false`, logic layer … |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `lexicalSearch`         | Skips lexical arm; merge with text-only content may still run if you implement FTS no-ops. |
| `vectorSearch`          | Skips vector arm; **rejects** merge content items with `vector`; vector-only search returns empty hits. |
| `vectorKnnSearch`       | Exact cosine path unavailable; explicit `knn` is a noop. |
| `vectorAnnSearch`       | Approximate index path unavailable; explicit `ann` is a noop. |
| `neighborIndex`         | Skips neighbor listing and expansion in search.                                            |
| `graphIndex`            | Graph topology reads (`loadGraphEdgesForNamespace`, `loadNodeLabelsForNamespace`, `loadNodePropertiesForNamespace`, `listIncidentGraphEdges`, `loadGraphNode`, …) return **empty** / **null** as documented. |
| `multiNamespaceSearch` | For hybrid search with **multiple** namespaces in `scope`, runs **separate** per-namespace retrieval calls and merges with RRF in core (no need to implement `IN` lists yourself). |
| `unscopedSearch`        | **`searchEntireDatabase`** on `SearchParams` throws; `scope: { kind: "unscoped" }` is not used. |

Thin adapters that only support one namespace per query should set **`multiNamespaceSearch: false`**; core still works via the fallback path.

Reference backends ship with lexical/vector/neighbor/graph/multi-namespace on; **KNN** on; **ANN** when the driver/vector extension is available (SQLite detects at open; libSQL/Turso take an option, default off).

## Search-meta (hybrid chunk)

- Reserved `source_key`: [`MEMORY_SEARCH_META_SOURCE_KEY`](./core/search-meta-constants.ts) (`__mem_search_meta__`).
- `syncMemorySearchMeta` rebuilds canonical text for the meta chunk from **node label kinds** and **incident edge kinds** (topology line); optional `metaVector` on the primary memory during merge.
- Merge pipeline: [`upsertMemorySearchMetaVector`](./core/persistence/facade.ts) updates vectors for multiple keys in a transaction. The `@khoralabs/memories-node/helpers` function `mergeLogicalMemoryWithMergeSlice` **skips** this batch entirely when `vectorSearch` is `false` (no embed RPC). If you need vectors stored without vector retrieval, extend the caller. Reference SQLite expects vector search for meta retrieval.

## Label-props search chunks (optional)

- **Purpose:** Lexical index for **ontology `props`** on node and edge label **assignments** without stuffing raw JSON into the topology meta line. Topology meta (`node:…` / `edge …`) still lists **kinds** only.
- **Reserved keys:** [`memoryNodeLabelPropsSourceKey`](./core/search-meta-constants.ts) (`__mem_nl_props__/…`) per `node_label_assignments._id`, and [`memoryEdgeLabelPropsSourceKey`](./core/search-meta-constants.ts) (`__mem_edge_props__/…`) per **`edge_label_assignments._id`** (one chunk per assignment with non-empty props), on **each** endpoint memory.
- **Contract:** [`syncLabelPropsSearchFeatures?`](./core/persistence/types.ts) runs after `syncMemorySearchMeta` for each memory key in the merge invalidation set (see `mergeMemory`). It should **remove** prior `__mem_nl_props__*` / `__mem_edge_props__*` `source_map` rows for that memory, then insert fresh `text_features` (+ FTS) from **`kind` + `props`** on assignment rows (join catalog for `kind` if stored only by `label_id`).
- **Human-readable text:** Use [`formatLabelPropsForSearch`](./core/models/label-props-search-text.ts) with an optional per-app [`LabelPropsSearchFormatter`](./core/models/label-props-search-text.ts). Reference backends pass an optional formatter from `createMemoriesPersistence` / `createMemoriesLibsqlPersistence` / `createMemoriesTursoServerlessPersistence` options.
- **Vectors:** Not indexed on these chunks in v1 (optional follow-up).

## Graph projections (optional)

Persistence-agnostic layout/source types live in **`@khoralabs/memories-node/projections`**. Backend strategies:

- **SQLite:** `@khoralabs/memories-node/sqlite` — `createSqliteGraphProjectionSource`, `buildNamespaceGraphLayout`, `collectSqliteProjectionInput`, `createMemoriesVisualization`, …
- **libSQL:** `@khoralabs/memories-node/libsql` — `createLibsqlGraphProjectionSource`, async layout helpers, `createLibsqlMemoriesVisualization`, …

UMAP layout, mean-pooled embeddings, and UI preview helpers are **not** part of the persistence contract; implementors may omit them.

## Async persistence

[`MemoriesPersistenceAsync`](./core/persistence/async-types.ts) mirrors the sync interface with `Promise`-returning methods and `withTransaction(fn: () => Promise<T>): Promise<T>`. Use `MemoriesClientAsync` and `mergeMemoryAsync` / `searchAsync` / `deleteMemoryAsync` when implementing remote or non-blocking stores.

**Note:** [`wrapSyncMemoriesPersistenceAsAsync`](./core/persistence/wrap-sync-as-async.ts) does not support a real async transaction—use native async backends (or SQLite’s `createMemoriesPersistenceAsync`) for `mergeMemoryAsync` inside `withTransaction`.

## Conformance tests

New backends should run the shared suite from `@khoralabs/memories-node/testing`:

```ts
import { runMemoriesPersistenceContractTests } from "@khoralabs/memories-node/testing";

runMemoriesPersistenceContractTests("my-backend", () => openMyPersistence());
```

Projection strategies can additionally run `runMemoriesProjectionsContractTests` from the same export.

The harness is async-first (`MemoriesPersistenceAsync` + `mergeMemoryAsync` / `searchAsync` / `deleteMemoryAsync`). Capability-gated suites skip when `MemoriesBackendCapabilities` reports a feature off. Keep SQL/schema/driver unit tests next to the implementation (see each backend’s `contract.test.ts`).
