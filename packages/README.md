# Memories system guide

Deep dive for this workspace: mental model, package map, merge/search pipelines, schema, and where code lives. For a short product overview, see the [root README](../README.md).

---

## 1. Package structure

```text
┌──────────────────────────────────────────────────────────┐
│ @khoralabs/memories-node                                 │
│ .  ./persistence ./provenance ./helpers ./ontology       │
│ ./sqlite|libsql|turso-serverless                         │
│ ./projections ./attestation ./autolink ./testing         │
└───────┬───────────────────────────────┬──────────────────┘
        │                               │
┌───────▼────────────────┐   ┌──────────▼──────────────────┐
│ memories-service       │   │ memories-agents             │
│ ./client ./http ./auth │   │ ./tools ./adapter           │
│ ./storage/* ./testing  │   │ ./integrator ./investigator │
└────────────────────────┘   └─────────────────────────────┘
        optional: memories-react-graph, memories-spec
```

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-node` | [`node/`](node) | Single-DB client, contracts, backends, ontology, projections, attestation, autolink |
| `@khoralabs/memories-service` | [`service/`](service) | Multi-tenant lifecycle, placement, HTTP, auth |
| `@khoralabs/memories-agents` | [`agents/`](agents) | `memory_search` toolkit + adapter / integrator / investigator |
| `@khoralabs/memories-react-graph` | [`react/graph/`](react/graph) | Host-injected 3D graph UI |
| `@khoralabs/memories-spec` | [`spec/`](spec) | Smithy capability modules (IDL only) |

**Rationale for the split**

- **Node** owns merge/search semantics and storage adapters so embedders never need HTTP.
- **Service** owns principal identity, placement routing, and auth — control plane separate from the node data plane.
- **Agents** sit on top of the client API via `@khoralabs/agent-capabilities`.
- **React graph** stays transport-agnostic: hosts supply layout + search.
- **Spec** documents capability modules for implementors; TypeScript does not depend on it at runtime.

### Mental model

A **memory** is a logical unit keyed by `(namespace, key)` with `kind: "node" | "edge"`:

- **Node memories** attach to a primary graph node and hold searchable content.
- **Edge memories** attach to one graph edge (at most one memory per edge).

Each memory has many **source maps** — one per content chunk (`source_key`). Each source map can have:

- **Text features** → lexical search (FTS)
- **Vector features** → vector search (sqlite-vec)

Search returns **rank-ordered `source_map` ids**; core merges lexical + vector arms with **Reciprocal Rank Fusion (RRF)**.

### Key types

**Persistence contract** — [`node/src/persistence/core/persistence/types.ts`](node/src/persistence/core/persistence/types.ts) (export `@khoralabs/memories-node/persistence`):

- `MemoriesPersistence` = mutation + retrieval + neighbors + reads + graph
- `MemoriesMutationCore` — merge/delete, source maps, features, scopes, provenance
- `MemoriesRetrieval` — `searchLexicalSourceMapIds`, `searchVectorSourceMapIds`, `hydrateSourceMapHits`
- `MemoriesGraph` — topology reads + graph writes
- `MemoriesBackendCapabilities` — feature flags per backend
- `SearchNamespaceScope` — `pathSubtree | scopeDag | exactScope | unscoped`

**Row model** — [`node/src/persistence/core/persistence/row-schemas.ts`](node/src/persistence/core/persistence/row-schemas.ts):

- `Memory`, `SourceMap`, `TextFeature`, `VectorFeature`, `Node`, `Edge`, scope tables, label catalogs/assignments
- `memoriesPersistenceDocumentSchema` — Zod source of truth for all table shapes

**Client API** — [`node/src/core/api/`](node/src/core/api/):

- `MemoriesClient` / `MemoriesClientAsync` — typed ontology + `mergeMemory`, `search`, `deleteMemory`, optional `resolveSourcesForMemory`
- `MergeMemoryParams` — node or edge merge with `content[]`, labels, edges, scopes
- `SearchParams` / `SearchHit` — hybrid search with neighbor expansion

**Stable IDs** — [`node/src/persistence/core/models/ids.ts`](node/src/persistence/core/models/ids.ts):

```typescript
ids.memory(namespace, key)      // mem_*
ids.sourceMap(memoryId, key)  // sm_*
ids.textFeature(sourceMapId)  // tf_*
ids.vectorFeature(sourceMapId)// vf_*
```

### Merge flow (indexing trigger)

[`node/src/core/api/merge-memory.ts`](node/src/core/api/merge-memory.ts):

1. `clearMemorySubtree` — wipe old features, FTS, vec rows, source maps
2. `upsertMemory` + graph node/edge setup
3. For each content item: `insertSourceMap` → `insertLexicalFeature` / `insertVectorFeature` → `updateSourceMapContentHash`
4. Label assignments, edge inserts
5. `syncMemorySearchMeta` — synthetic topology chunk (`__mem_search_meta__`)
6. Optional `syncLabelPropsSearchFeatures` — ontology props chunks
7. `appendProvenanceEvent` — advances the linear hash chain; returns `{ root_hex }`
8. Optional `appendContentOutbox` — raw text alongside the provenance row for point-in-time reconstruction (SQLite implements this)

---

## 2. SQLite schema and search

Reference backend: [`node/src/persistence/sqlite/`](node/src/persistence/sqlite/). LibSQL and Turso serverless mirror the same logical schema under their own trees.

### Schema

[`node/src/persistence/sqlite/persistence/schema.ts`](node/src/persistence/sqlite/persistence/schema.ts)

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

### Virtual / index tables

[`node/src/persistence/sqlite/persistence/search-indexes.ts`](node/src/persistence/sqlite/persistence/search-indexes.ts):

- **`text_features_fts`** — FTS5 virtual table mirroring `text_features` (tokenizer: `porter unicode61`)
- **`vector_features_vec_d_<dim>`** — sqlite-vec `vec0` tables, one per embedding dimension (512–3072)

### Search

**Lexical** — FTS5 `MATCH` with `bm25()` ranking; scoped via memory-id subquery.

**Vector** — KNN on dimension-specific `vec0` table; optional `maxVectorDistance` cutoff.

**Hybrid merge** — [`node/src/core/api/search.ts`](node/src/core/api/search.ts): RRF fusion (`node/src/core/rrf`); optional neighbor sub-search; multi-namespace merge when the backend lacks `multiNamespaceSearch`.

**Backend capabilities** (SQLite = full):

```typescript
{ lexicalSearch, vectorSearch, neighborIndex, graphIndex,
  multiNamespaceSearch, unscopedSearch: false }
```

### Migrations

| Migration | Change |
|-----------|--------|
| `0.0.0-0.1.0/001-initial` | Initial schema, indexes, FTS5 (`porter unicode61`) |
| `0.1.0-0.2.0/001-add-content-outbox` | `memory_content_outbox` for point-in-time text reconstruction |

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

**Memories-specific source maps** — row schemas in `@khoralabs/memories-node/persistence`:

```typescript
type SourceMapLocators = { memory_id: string; source_key: string };
type SourceMap = SourceRef<SourceMapLocators> & { content_hash?: ContentHash };
```

**Client resolution** — `MemoriesClient.resolveSourcesForMemory(namespace, memoryId, limit)` lists source maps and calls `store.resolve(sm)` for each ([`node/src/core/api/resolve-sourcemap.ts`](node/src/core/api/resolve-sourcemap.ts)).

**Content hash** — SHA-256 over canonical descriptor of text/vector payloads; stored in `source_maps.content_hash` ([`node/src/persistence/core/provenance/`](node/src/persistence/core/provenance/)).

---

## 4. Indexing

### Write path (merge-time)

For each `MergeMemoryContentItem: { key, text?, vector? }`:

1. `insertSourceMap`
2. **Lexical** → `text_features` + FTS sync
3. **Vector** → `vector_features` + `vec0` table
4. **Content hash** — `updateSourceMapContentHash`

### System-generated chunks

Reserved source keys — [`node/src/persistence/core/search-meta-constants.ts`](node/src/persistence/core/search-meta-constants.ts):

| Key | Purpose |
|-----|---------|
| `__mem_search_meta__` | Topology summary (node labels + incident edge kinds) |
| `__mem_nl_props__/<assignmentId>` | Node label props for lexical search |
| `__mem_edge_props__/<assignmentId>` | Edge label props for lexical search |

### Logical memory decomposition

[`node/src/core/helpers/logical-memory.ts`](node/src/core/helpers/logical-memory.ts) (export `@khoralabs/memories-node/helpers`): plaintext → `text:*` chunks; files → `file:i:*` chunks. Used by the integrator agent pipeline.

**Embedding** — `embedTextChunks`, `createMemoriesEmbeddingModel` in the same helpers entrypoint.

### Search pipeline (read path)

[`node/src/core/helpers/memory-search-pipeline.ts`](node/src/core/helpers/memory-search-pipeline.ts) — `runHybridMemorySearch`: embeds query, calls client search, returns slim hits for agents.

---

## 5. Ontology

Ontology is a Zod / Standard Schema map of node and edge label kinds. Assemble from families under `@khoralabs/memories-node/ontology/families/*`:

| Family | Role |
|--------|------|
| `entities` | Person, place, and related entity shapes |
| `knowledge` | Facts / claims |
| `preferences` | Preference nodes |
| `relations` | Canonical relation edges |
| `temporal` | Events and temporal edges |
| `poleo` | POLE+O (person, object, location, event, organization) |
| `retrieval` | Similarity / retrieval edges |
| `salience` | Salience + retrieval composition |

Use `defineOntology` / `mergeOntologies`. The old `canonicalOntology` export is **deprecated** — prefer composing families for your app.

---

## 6. Agents, service, and UI

| Surface | Role |
|---------|------|
| `@khoralabs/memories-agents/tools` | `memorySearchToolkit` — hybrid search + provenance snapshot |
| `@khoralabs/memories-agents/investigator` | Multi-step Q&A over one or many namespaces |
| `@khoralabs/memories-agents/integrator` | Decompose + embed + merge logical memories |
| `@khoralabs/memories-agents/adapter` | Domain payload → memory draft |
| `@khoralabs/memories-node/autolink` | `integrateNewMemoryIntoGraph` — search, link patch, merge |
| `@khoralabs/memories-service` | Multi-tenant open/list/delete, placement, HTTP, auth |
| `@khoralabs/memories-react-graph` | React 3D graph: search, namespaces, investigator overlay |

Wire agents with `@khoralabs/agent-capabilities` (`createAgentRegistry`, tool loops). Each package README has package-specific usage.

Service architecture: [`service/spec.md`](service/spec.md). Planned work: [`service/roadmap/`](service/roadmap/).

---

## Key file index

| Area | Path |
|------|------|
| Core API | `node/src/core/api/{client,merge-memory,search,resolve-sourcemap}.ts` |
| Persistence types | `node/src/persistence/core/persistence/{types,row-schemas}.ts` |
| Provenance | `node/src/persistence/core/provenance/` |
| SQLite schema | `node/src/persistence/sqlite/persistence/{schema,search-indexes}.ts` |
| SQLite models | `node/src/persistence/sqlite/persistence/models/` |
| Helpers | `node/src/core/helpers/` |
| Ontology | `node/src/ontology/` |
| Implementor guide | `node/src/persistence/IMPLEMENTORS.md` |
| Smithy | `spec/model/persistence.smithy` |
| Service design | `service/spec.md` |

---

## Summary

`@khoralabs/memories-node` owns merge/search semantics and the `MemoriesPersistence` contract; `./sqlite` is the reference Bun backend (libSQL / Turso are async peers). **Source maps** bridge indexed projections to optional external content via `@khoralabs/sourcemaps`. Indexing is transactional on merge: one source map per chunk, lexical + vector indexes, plus system meta chunks. Agents, autolink, the multi-tenant service, and `memories-react-graph` are the primary consumers.
