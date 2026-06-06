# Memories System

The memories system is a **monorepo of packages under `packages/memories/`**, plus shared primitives in `packages/libs/sourcemaps/`. It implements a **knowledge-graph memory store** with hybrid lexical + vector search, graph topology, provenance, and optional external content resolution via generic sourcemaps.

---

## 1. Package Structure and How It Works

### Architecture overview

```text
┌─────────────────────────────────────────────────────────────┐
│  @khoralabs/memories-core          (logic + contracts)      │
│  MemoriesClient, mergeMemory, search, provenance, IDs       │
└───────────────┬───────────────────────────────┬─────────────┘
                │                               │
    ┌───────────▼──────────┐         ┌──────────▼──────────────┐
    │ memories-sqlite      │         │ memories-convex         │
    │ (reference backend)  │         │ (hosted async backend)  │
    └───────────┬──────────┘         └─────────────────────────┘
                │
    ┌───────────▼──────────────────────────────────────────────┐
    │ agents/* (adapter, integrator, investigator, tools)        │
    │ autolink, react/graph, stores, spec (Smithy)               │
    └────────────────────────────────────────────────────────────┘
```

### Core packages

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-core` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/` | Contracts, merge/search/delete APIs, IDs, provenance, helpers |
| `@khoralabs/memories-sqlite` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/` | Reference sync `MemoriesPersistence` (FTS5 + sqlite-vec) |
| `@khoralabs/memories-convex` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/convex/` | Async `MemoriesPersistenceAsync` for Convex |
| `@khoralabs/memories-stores` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/stores/` | File-backed `Store` implementations (JSONL) |
| `@khoralabs/sourcemaps` | `/Users/zach/Documents/dev/khora-labs/khora/packages/libs/sourcemaps/` | Generic ref → resolve types (domain-agnostic) |
| `@khoralabs/memories-spec` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/spec/` | Smithy wire model |
| `@khoralabs/memories-autolink` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/autolink/` | Search-then-link graph integration |
| `@khoralabs/memories-*` agents | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/agents/` | LLM agents (adapter, integrator, investigator, tools) |
| `@khoralabs/memories-react-graph` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/react/graph/` | Graph visualization UI |
| `apps/memories` | `/Users/zach/Documents/dev/khora-labs/khora/apps/memories/` | Demo server (search, graph, investigator) |

### Mental model

A **memory** is a logical unit keyed by `(namespace, key)` with `kind: "node" | "edge"`:

- **Node memories** attach to a primary graph node and hold searchable content.
- **Edge memories** attach to one graph edge (at most one memory per edge).

Each memory has many **source maps** — one per content chunk (`source_key`). Each source map can have:

- **Text features** → lexical search (FTS / Convex search index)
- **Vector features** → vector search (sqlite-vec / Convex vector search)

Search returns **rank-ordered `source_map` ids**; core merges lexical + vector arms with **Reciprocal Rank Fusion (RRF)**.

### Key types/interfaces

**Persistence contract** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/persistence/types.ts`:

- `MemoriesPersistence` = mutation + retrieval + neighbors + reads + graph
- `MemoriesMutationCore` — merge/delete, source maps, features, scopes, provenance
- `MemoriesRetrieval` — `searchLexicalSourceMapIds`, `searchVectorSourceMapIds`, `hydrateSourceMapHits`
- `MemoriesGraph` — topology reads + graph writes
- `MemoriesBackendCapabilities` — feature flags per backend
- `SearchNamespaceScope` — `pathSubtree | scopeDag | exactScope | unscoped`

**Row model** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/persistence/row-schemas.ts`:

- `Memory`, `SourceMap`, `TextFeature`, `VectorFeature`, `Node`, `Edge`, scope tables, label catalogs/assignments
- `memoriesPersistenceDocumentSchema` — Zod source of truth for all table shapes

**Client API** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/api/`:

- `MemoriesClient` — typed ontology + `mergeMemory`, `search`, `deleteMemory`, optional `resolveSourcesForMemory`
- `MergeMemoryParams` — node or edge merge with `content[]`, labels, edges, scopes
- `SearchParams` / `SearchHit` — hybrid search with neighbor expansion

**Stable IDs** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/models/ids.ts`:

```typescript
ids.memory(namespace, key)      // mem_*
ids.sourceMap(memoryId, key)  // sm_*
ids.textFeature(sourceMapId)  // tf_*
ids.vectorFeature(sourceMapId)// vf_*
```

### Merge flow (indexing trigger)

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/api/merge-memory.ts`:

1. `clearMemorySubtree` — wipe old features, FTS, vec rows, source maps
2. `upsertMemory` + graph node/edge setup
3. For each content item: `insertSourceMap` → `insertLexicalFeature` / `insertVectorFeature` → `updateSourceMapContentHash`
4. Label assignments, edge inserts
5. `syncMemorySearchMeta` — synthetic topology chunk (`__mem_search_meta__`)
6. Optional `syncLabelPropsSearchFeatures` — ontology props chunks
7. `appendProvenanceEvent` — linear hash chain

---

## 2. SQLite Schema and Search Capabilities

### DDL snapshot

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/schema.ts`

**Core tables:**

| Table | Purpose |
|-------|---------|
| `memories` | Root rows: `namespace`, `key`, `kind`, `edge_id`, denormalized `ns_prefix_1..6` |
| `source_maps` | Address per chunk: `memory_id`, `source_key`, optional `content_hash` |
| `text_features` | Searchable text per source map |
| `vector_features` | Embedding blob per source map |
| `nodes`, `edges` | Graph topology |
| `node_labels`, `edge_labels` | Ontology catalog |
| `node_label_assignments`, `edge_label_assignments` | Instance props |
| `scopes`, `scope_edges`, `scope_closure`, `memory_scopes` | DAG visibility |
| `memory_provenance` | Append-only mutation chain |

**Indexes** (B-tree): on `memory_id`, `source_map_id`, edge endpoints, scope closure, etc.

### Virtual/index tables (not in base DDL)

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/search-indexes.ts`:

- **`text_features_fts`** — FTS5 virtual table mirroring `text_features`
  - Tokenizer: `porter unicode61`
  - Columns: `text_feature_id`, `memory_id`, `source_map_id` (UNINDEXED), `text` (indexed)
- **`vector_features_vec_d_<dim>`** — sqlite-vec `vec0` tables, one per embedding dimension (512–3072)

### Search capabilities

**Lexical** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/models/search.ts`:

- `searchLexicalSourceMapIds` — FTS5 `MATCH` with `bm25()` ranking
- Query builder `buildFtsMatchFromUserText` — AND-combined phrase terms with prefix fallback
- Scoped via memory-id subquery (namespace prefix, scope DAG, exact scope, as-of timestamp)

**Vector** — same file:

- `searchVectorSourceMapIds` — KNN on dimension-specific `vec0` table
- Optional `maxVectorDistance` cutoff
- Widen K when filtering by `memoryIds` allowlist

**Hybrid merge** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/api/search.ts`:

- Runs both arms, fuses with RRF (`packages/core/src/rrf`)
- Optional neighbor sub-search on graph-adjacent memories
- Label filters, `topK`, `minScore`, multi-namespace (RRF merge if backend lacks `multiNamespaceSearch`)

**Scope modes** (`SearchNamespaceScope`):

- `pathSubtree` — prefix match on `memories.ns_prefix_*`
- `scopeDag` — transitive scope closure
- `exactScope` — direct scope attachment only
- `unscoped` — entire DB (requires capability)

**Backend capabilities** (SQLite = full):

```typescript
{ lexicalSearch, vectorSearch, neighborIndex, graphIndex,
  multiNamespaceSearch, unscopedSearch: false }
```

### Migrations

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/migrations/`:

- `0.0.0-0.1.0` — initial schema + FTS
- `0.1.0-0.2.0` — `source_maps.content_hash`
- `0.2.0-0.3.0` — FTS porter rebuild

---

## 3. Generic Sourcemaps — How They Work

### Shared library (`@khoralabs/sourcemaps`)

`/Users/zach/Documents/dev/khora-labs/khora/packages/libs/sourcemaps/README.md`  
`/Users/zach/Documents/dev/khora-labs/khora/packages/libs/sourcemaps/src/types.ts`

**Pattern:** separate **address** (ref) from **projection** (search index rows):

```text
SourceRef (locators)  ──Store.resolve()──►  ResolvedSource (original content)
                                              │
Projection lives elsewhere:                   │
  text_features, vector_features, etc.  ◄───┘ keyed BY source map address
```

**Core types:**

| Type | Role |
|------|------|
| `SourceRef<Locators>` | Stable address; optional `content_hash` |
| `ContentAddressedRef<Locators>` | Required hash for verify-on-read |
| `ContentHash` | Lowercase SHA-256 hex (64 chars) |
| `Store<Ref, EntityMap>` | `resolve(ref) → ResolvedSource` |
| `ResolvedSource` | Discriminated union: `string`, `blob`, `url`, `json`, `record` |
| `ResolvedSourceWire` | JSON-serializable mirror (blobs as base64) |
| `resolveSourcemap(ref, store)` | Thin helper |

### Memories-specific source maps

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/persistence/row-schemas.ts`:

```typescript
type SourceMapLocators = { memory_id: string; source_key: string };
type SourceMap = SourceRef<SourceMapLocators> & { content_hash?: ContentHash };
```

**Memories `Store` extension** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/api/resolve-sourcemap.ts`:

```typescript
interface Store<EntityMap> extends GenericStore<SourceMap, EntityMap> {
  syncFromTextExportRows?(rows: TextFeatureExportRow[]): void;
}
type ResolvedSourceMapLine = SourceMapRef & ResolvedSourceWire;  // JSONL wire format
```

### Mapping to external data

Source maps in memories are **not** the canonical body — they are addresses. External resolution paths:

1. **JSONL file store** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/stores/src/jsonl/jsonl-store.ts`
   - Lines: `{ memory_id, source_key, kind, ...body }` (e.g. `kind: "string"`, `kind: "blob"`, `kind: "record"`)
   - `resolve(sourcemap)` looks up by `(memory_id, source_key)`
   - After merge, `MemoriesClient` calls `syncFromTextExportRows` to mirror lexical text into JSONL

2. **Convex lexical store** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/convex/src/convexLexicalTextStore.ts`
   - Resolves from Convex `text_features` via component query

3. **Colonnade (separate domain)** — `/Users/zach/Documents/dev/khora-labs/khora/packages/colonnade/impl/ts/src/resolve-pointer.ts`
   - Uses same `@khoralabs/sourcemaps` pattern with `{ cell_id, record_key }` locators

4. **Khora host** — `/Users/zach/Documents/dev/khora-labs/khora/apps/khora/host/src/resolve-post.ts`, `relay-inbox-drain.ts`
   - Resolves colonnade pointers via `resolveSourcemap`

**Content hash (provenance, not resolution identity):**

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/provenance/source-body-hash.ts`:

```
SHA-256(MEMORIES_SOURCE_BODY_v1 || canonical_json({
  text_present, text_sha256, vector_present, vector_dim, vector_sha256
}))
```

Stored in `source_maps.content_hash`; included in merge provenance events.

**Client resolution API:**

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/api/client.ts` — `resolveSourcesForMemory(namespace, memoryId, limit)`:
- Lists source maps from persistence
- Calls `store.resolve(sm)` for each
- Returns `{ sourceKey, content }` or `null` on miss

---

## 4. How Indexing Works

### Write path (merge-time)

For each user content item (`MergeMemoryContentItem: { key, text?, vector? }`):

1. **`insertSourceMap`** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/models/source-maps.ts`
   - ID: `ids.sourceMap(memoryId, sourceKey)`

2. **Lexical index** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/models/text-features.ts`
   - Insert into `text_features`
   - Sync into `text_features_fts` via prepared statement

3. **Vector index** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/models/vector-features.ts`
   - Insert blob into `vector_features`
   - `ensureVectorFeaturesVecTable(db, dim)` — create vec0 table if needed
   - Insert into `vector_features_vec_d_<dim>`

4. **Content hash** — `updateSourceMapContentHash`

### System-generated index chunks

Reserved source keys — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/search-meta-constants.ts`:

| Key | Purpose |
|-----|---------|
| `__mem_search_meta__` | Topology summary (node labels + incident edge kinds); optional vector |
| `__mem_nl_props__/<assignmentId>` | Node label props for lexical search |
| `__mem_edge_props__/<assignmentId>` | Edge label props for lexical search |

Built by `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/models/memory-search-meta.ts` and `label-props-search.ts`.

### Logical memory decomposition (multi-chunk indexing)

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/helpers/logical-memory.ts`:

- Plaintext → `text:*` chunks via `textToContent`
- Files → `file:i:*` chunks via `fileToContent`
- Each chunk gets its own source map + text + vector features
- Used by integrator agent pipeline

**Embedding model** — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/helpers/embedding-model.ts` — `embedTextChunks`, `createMemoriesEmbeddingModel`

### Delete / re-index

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/models/memory-subtree.ts`:

On merge, subtree clear removes: scope attachments, vec0 rows, FTS rows, text/vector features, source maps, graph edges (nodes), label assignments.

### Search pipeline (read path)

`/Users/zach/Documents/dev/khora-labs/khora/packages/memories/core/src/helpers/memory-search-pipeline.ts` — `runHybridMemorySearch`:

- Embeds query text if embedding model provided
- Calls client search with lexical + vector arms
- Returns slim `MemorySearchHit[]` for agents

Convex indexing mirrors the same contract with Convex search/vector indexes instead of FTS5/sqlite-vec.

---

## 5. Integration Points

### Apps

| Integration | Path | Usage |
|-------------|------|-------|
| **memories demo app** | `/Users/zach/Documents/dev/khora-labs/khora/apps/memories/src/index.ts` | Full stack: SQLite readonly DB, hybrid search API, graph layout, memory investigator agent |
| **OBP v2 SQLite** | `/Users/zach/Documents/dev/khora-labs/khora/packages/obp/v2/persistence/sqlite/src/connection.ts` | Reuses `ensureCustomSqliteForExtensions` from memories-sqlite |

### Agent layer

| Package | Path | Role |
|---------|------|------|
| `memories-tools` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/agents/tools/src/memory-search-toolkit.ts` | `memory_search` tool for LLM agents; hybrid search + provenance snapshot |
| `memories-investigator` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/agents/investigator/` | Multi-step Q&A over memories |
| `memories-integrator` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/agents/integrator/src/logical-memory-pipeline.ts` | Decompose + embed + merge logical memories |
| `memories-adapter` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/agents/adapter/` | Ontology-aware adapter agent |

### Graph / autolink

| Package | Path | Role |
|---------|------|------|
| `memories-autolink` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/autolink/src/integrate.ts` | `integrateNewMemoryIntoGraph` — search existing graph, compute link patch, merge |
| `memories-react-graph` | `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/react/graph/src/graph-search.tsx` | React graph search UI |

### Persistence backends

| Backend | Entry point | Notes |
|---------|-------------|-------|
| SQLite | `createMemoriesPersistence(db)` — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/src/persistence.ts` | Reference implementation |
| Convex | `createConvexMemoriesPersistence(client)` — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/convex/` | Async; fixed embedding dims; atomic merge overload |
| JSONL store | `JsonlStore` — `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/stores/src/jsonl/jsonl-store.ts` | External content mirror for `Store.resolve` |
| Convex lexical store | `createConvexLexicalTextStore` | Resolve from Convex text_features |

### Spec / docs

- Smithy model: `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/spec/model/persistence.smithy`
- Implementor guides:
  - `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/IMPLEMENTORS.md`
  - `/Users/zach/Documents/dev/khora-labs/khora/packages/memories/persistence/sqlite/IMPLEMENTORS.md`

### Not integrated (yet)

- **`apps/khora`** — no direct `MemoriesClient` usage found; uses `@khoralabs/sourcemaps` via colonnade for post/pointer resolution, not the memories KG
- **`apps/vellum`** — no memories imports found

---

## Key File Index

| Area | Files |
|------|-------|
| Core API | `packages/memories/core/src/api/{client,merge-memory,search,resolve-sourcemap}.ts` |
| Persistence types | `packages/memories/core/src/persistence/{types,row-schemas}.ts` |
| Provenance | `packages/memories/core/src/provenance/{source-body-hash,hash-chain}.ts` |
| SQLite schema | `packages/memories/persistence/sqlite/src/{schema,connection,search-indexes}.ts` |
| SQLite models | `packages/memories/persistence/sqlite/src/models/{source-maps,text-features,vector-features,search,memory-search-meta,memory-subtree}.ts` |
| Generic sourcemaps | `packages/libs/sourcemaps/src/{types,index}.ts` |
| Stores | `packages/memories/stores/src/jsonl/jsonl-store.ts` |
| Helpers | `packages/memories/core/src/helpers/{logical-memory,embedding-model,memory-search-pipeline}.ts` |
| Demo app | `apps/memories/src/index.ts` |

---

## Summary

Memories is a **layered KG + search system**: `@khoralabs/memories-core` owns merge/search semantics and the `MemoriesPersistence` contract; backends (SQLite reference, Convex hosted) materialize relational rows plus FTS5/sqlite-vec or Convex indexes. **Source maps** bridge indexed projections to external canonical content via the generic `@khoralabs/sourcemaps` `Store.resolve` pattern, with memories-specific locators `{ memory_id, source_key }`. Indexing happens transactionally on merge: one source map per content chunk, synced into lexical and vector indexes, plus system meta chunks for topology and ontology props. Agents, autolink, and `apps/memories` are the primary consumers today.