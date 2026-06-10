# Memories System

This workspace implements a **knowledge-graph memory store** with hybrid lexical + vector search, graph topology, provenance, and optional external content resolution via [`@khoralabs/sourcemaps`](https://github.com/khoralabs/sourcemaps).

---

## 1. Package structure

### Architecture overview

```text
┌─────────────────────────────────────────────────────────────┐
│  @khoralabs/memories-core          (logic + contracts)      │
│  MemoriesClient, mergeMemory, search, provenance, IDs       │
└───────────────┬─────────────────────────────────────────────┘
                │
    ┌───────────▼──────────┐
    │ memories-sqlite      │
    │ (reference backend)  │
    └───────────┬──────────┘
                │
    ┌───────────▼──────────┐     ┌─────────────────────────────┐
    │ sqlite-graph-        │     │ agents/*, autolink,         │
    │ projections (opt.)   │     │ ontologies, react/graph, spec │
    └──────────────────────┘     └─────────────────────────────┘
```

### Packages in this repo

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-core` | [`core/`](core) | Contracts, merge/search/delete APIs, IDs, provenance, helpers |
| `@khoralabs/memories-sqlite` | [`persistence/sqlite/`](persistence/sqlite) | Reference sync `MemoriesPersistence` (FTS5 + sqlite-vec) |
| `@khoralabs/sqlite-graph-projections` | [`persistence/sqlite-graph-projections/`](persistence/sqlite-graph-projections) | Optional UMAP layout + mean embeddings + UI previews |
| `@khoralabs/memories-ontologies` | [`ontologies/`](ontologies) | Default personal/agent ontology vocabulary |
| `@khoralabs/memories-spec` | [`spec/`](spec) | Smithy wire model |
| `@khoralabs/memories-autolink` | [`autolink/`](autolink) | Search-then-link graph integration |
| `@khoralabs/memories-*` agents | [`agents/`](agents) | LLM agents (adapter, integrator, investigator, tools) |
| `@khoralabs/memories-react-graph` | [`react/graph/`](react/graph) | Graph visualization UI |

### Mental model

A **memory** is a logical unit keyed by `(namespace, key)` with `kind: "node" | "edge"`:

- **Node memories** attach to a primary graph node and hold searchable content.
- **Edge memories** attach to one graph edge (at most one memory per edge).

Each memory has many **source maps** — one per content chunk (`source_key`). Each source map can have:

- **Text features** → lexical search (FTS)
- **Vector features** → vector search (sqlite-vec)

Search returns **rank-ordered `source_map` ids**; core merges lexical + vector arms with **Reciprocal Rank Fusion (RRF)**.

### Key types

**Persistence contract** — [`core/src/persistence/types.ts`](core/src/persistence/types.ts):

- `MemoriesPersistence` = mutation + retrieval + neighbors + reads + graph
- `MemoriesMutationCore` — merge/delete, source maps, features, scopes, provenance
- `MemoriesRetrieval` — `searchLexicalSourceMapIds`, `searchVectorSourceMapIds`, `hydrateSourceMapHits`
- `MemoriesGraph` — topology reads + graph writes
- `MemoriesBackendCapabilities` — feature flags per backend
- `SearchNamespaceScope` — `pathSubtree | scopeDag | exactScope | unscoped`

**Row model** — [`core/src/persistence/row-schemas.ts`](core/src/persistence/row-schemas.ts):

- `Memory`, `SourceMap`, `TextFeature`, `VectorFeature`, `Node`, `Edge`, scope tables, label catalogs/assignments
- `memoriesPersistenceDocumentSchema` — Zod source of truth for all table shapes

**Client API** — [`core/src/api/`](core/src/api/):

- `MemoriesClient` — typed ontology + `mergeMemory`, `search`, `deleteMemory`, optional `resolveSourcesForMemory`
- `MergeMemoryParams` — node or edge merge with `content[]`, labels, edges, scopes
- `SearchParams` / `SearchHit` — hybrid search with neighbor expansion

**Stable IDs** — [`core/src/models/ids.ts`](core/src/models/ids.ts):

```typescript
ids.memory(namespace, key)      // mem_*
ids.sourceMap(memoryId, key)  // sm_*
ids.textFeature(sourceMapId)  // tf_*
ids.vectorFeature(sourceMapId)// vf_*
```

### Merge flow (indexing trigger)

[`core/src/api/merge-memory.ts`](core/src/api/merge-memory.ts):

1. `clearMemorySubtree` — wipe old features, FTS, vec rows, source maps
2. `upsertMemory` + graph node/edge setup
3. For each content item: `insertSourceMap` → `insertLexicalFeature` / `insertVectorFeature` → `updateSourceMapContentHash`
4. Label assignments, edge inserts
5. `syncMemorySearchMeta` — synthetic topology chunk (`__mem_search_meta__`)
6. Optional `syncLabelPropsSearchFeatures` — ontology props chunks
7. `appendProvenanceEvent` — advances the linear hash chain; returns `{ root_hex }`
8. Optional `appendContentOutbox` — writes raw text content alongside the provenance row for point-in-time reconstruction (SQLite implements this)

---

## 2. SQLite schema and search

### Schema

[`persistence/sqlite/src/schema.ts`](persistence/sqlite/src/schema.ts)

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
| `memory_provenance` | Append-only mutation chain (hash-linked) |
| `memory_content_outbox` | Raw text per source key per merge/delete event, keyed by `root_hex` |

### Virtual/index tables

[`persistence/sqlite/src/search-indexes.ts`](persistence/sqlite/src/search-indexes.ts):

- **`text_features_fts`** — FTS5 virtual table mirroring `text_features` (tokenizer: `porter unicode61`)
- **`vector_features_vec_d_<dim>`** — sqlite-vec `vec0` tables, one per embedding dimension (512–3072)

### Search capabilities

**Lexical** — [`persistence/sqlite/src/models/search.ts`](persistence/sqlite/src/models/search.ts): FTS5 `MATCH` with `bm25()` ranking; scoped via memory-id subquery.

**Vector** — same file: KNN on dimension-specific `vec0` table; optional `maxVectorDistance` cutoff.

**Hybrid merge** — [`core/src/api/search.ts`](core/src/api/search.ts): RRF fusion (`core/src/rrf`); optional neighbor sub-search; multi-namespace merge when backend lacks `multiNamespaceSearch`.

**Backend capabilities** (SQLite = full):

```typescript
{ lexicalSearch, vectorSearch, neighborIndex, graphIndex,
  multiNamespaceSearch, unscopedSearch: false }
```

### Migrations

| Migration | Change |
|-----------|--------|
| `0.0.0-0.1.0/001-initial` | Initial schema, indexes, FTS5 (`porter unicode61`) |
| `0.1.0-0.2.0/001-add-content-outbox` | `memory_content_outbox` table for point-in-time text reconstruction |

---

## 3. Sourcemaps

### Shared library (`@khoralabs/sourcemaps`)

Separate **address** (ref) from **projection** (search index rows):

```text
SourceRef (locators)  ──Store.resolve()──►  ResolvedSource (original content)
                                              │
Projection lives elsewhere:                   │
  text_features, vector_features, etc.  ◄───┘ keyed BY source map address
```

**Memories-specific source maps** — [`core/src/persistence/row-schemas.ts`](core/src/persistence/row-schemas.ts):

```typescript
type SourceMapLocators = { memory_id: string; source_key: string };
type SourceMap = SourceRef<SourceMapLocators> & { content_hash?: ContentHash };
```

**Memories `Store` extension** — [`core/src/api/resolve-sourcemap.ts`](core/src/api/resolve-sourcemap.ts): optional `syncFromTextExportRows` for mirroring lexical text into an external store.

**Content hash** — [`core/src/provenance/source-body-hash.ts`](core/src/provenance/source-body-hash.ts): SHA-256 over canonical descriptor of text/vector payloads; stored in `source_maps.content_hash`.

**Client resolution** — `MemoriesClient.resolveSourcesForMemory(namespace, memoryId, limit)` lists source maps and calls `store.resolve(sm)` for each.

---

## 4. Indexing

### Write path (merge-time)

For each `MergeMemoryContentItem: { key, text?, vector? }`:

1. `insertSourceMap` — [`persistence/sqlite/src/models/source-maps.ts`](persistence/sqlite/src/models/source-maps.ts)
2. **Lexical** — [`text-features.ts`](persistence/sqlite/src/models/text-features.ts) → `text_features` + FTS sync
3. **Vector** — [`vector-features.ts`](persistence/sqlite/src/models/vector-features.ts) → `vector_features` + `vec0` table
4. **Content hash** — `updateSourceMapContentHash`

### System-generated chunks

Reserved source keys — [`core/src/search-meta-constants.ts`](core/src/search-meta-constants.ts):

| Key | Purpose |
|-----|---------|
| `__mem_search_meta__` | Topology summary (node labels + incident edge kinds) |
| `__mem_nl_props__/<assignmentId>` | Node label props for lexical search |
| `__mem_edge_props__/<assignmentId>` | Edge label props for lexical search |

### Logical memory decomposition

[`core/src/helpers/logical-memory.ts`](core/src/helpers/logical-memory.ts): plaintext → `text:*` chunks; files → `file:i:*` chunks. Used by the integrator agent pipeline.

**Embedding** — [`core/src/helpers/embedding-model.ts`](core/src/helpers/embedding-model.ts): `embedTextChunks`, `createMemoriesEmbeddingModel`.

### Search pipeline (read path)

[`core/src/helpers/memory-search-pipeline.ts`](core/src/helpers/memory-search-pipeline.ts) — `runHybridMemorySearch`: embeds query, calls client search, returns slim hits for agents.

---

## 5. Agent and UI integration

| Package | Role |
|---------|------|
| `memories-tools` | `memory_search` tool — hybrid search + provenance snapshot |
| `memories-investigator` | Multi-step Q&A over one or many namespaces |
| `memories-integrator` | Decompose + embed + merge logical memories |
| `memories-adapter` | Ontology-aware adapter: domain payload → memory draft |
| `memories-autolink` | `integrateNewMemoryIntoGraph` — search, link patch, merge |
| `memories-react-graph` | React 3D graph: search bar, namespace selector, investigator overlay |

Wire up agents with `@khoralabs/agent-capabilities` (`createAgentRegistry`, tool loops). Each agent package README has usage examples.

---

## Key file index

| Area | Files |
|------|-------|
| Core API | `core/src/api/{client,merge-memory,search,resolve-sourcemap}.ts` |
| Persistence types | `core/src/persistence/{types,row-schemas}.ts` |
| Provenance | `core/src/provenance/{source-body-hash,hash-chain}.ts` |
| SQLite schema | `persistence/sqlite/src/{schema,connection,search-indexes}.ts` |
| SQLite models | `persistence/sqlite/src/models/{source-maps,text-features,vector-features,search,memory-search-meta,memory-subtree}.ts` |
| Helpers | `core/src/helpers/{logical-memory,embedding-model,memory-search-pipeline}.ts` |
| Spec | `spec/model/persistence.smithy` |
| Implementor guide | `persistence/sqlite/IMPLEMENTORS.md` |

---

## Summary

`@khoralabs/memories-core` owns merge/search semantics and the `MemoriesPersistence` contract; `@khoralabs/memories-sqlite` is the reference backend materializing relational rows plus FTS5/sqlite-vec indexes. **Source maps** bridge indexed projections to external canonical content via `@khoralabs/sourcemaps` `Store.resolve`, with locators `{ memory_id, source_key }`. Indexing happens transactionally on merge: one source map per content chunk, synced into lexical and vector indexes, plus system meta chunks for topology and ontology props. Agents, autolink, and `memories-react-graph` are the primary in-repo consumers.
