# @khoralabs/memories-core

Logic layer and contracts for the memories knowledge graph: typed ontology, merge/search/delete APIs, stable IDs, provenance, and the `MemoriesPersistence` interface backends implement.

## Exports

| Subpath | Contents |
|---------|----------|
| `.` | `MemoriesClient`, `MemoriesClientAsync`, `mergeMemory`, `search`, `deleteMemory`, ontology helpers, namespace paths, graph types |
| `./persistence` | Row Zod schemas, `MemoriesPersistence` / `MemoriesPersistenceAsync` types, capabilities |
| `./provenance` | Hash chain helpers for merge/delete events |
| `./helpers` | `logical-memory` decomposition, `embedding-model`, `memory-search-pipeline`, `mergeOntologies`, `fileToContent` |
| `./search-meta-constants` | Reserved source keys for topology and label-props search chunks |

## Core types

- **`MemoriesClient`** — fixed ontology; validates label props via Standard Schema; calls `mergeMemory` / `search` / `deleteMemory` on a `MemoriesPersistence` backend. Optional `Store` from `@khoralabs/sourcemaps` for resolving canonical content behind source maps.
- **`MemoriesPersistence`** — sync contract: mutations, lexical + vector retrieval, neighbor index, graph reads/writes, provenance append. See [`packages/persistence/sqlite/IMPLEMENTORS.md`](../persistence/sqlite/IMPLEMENTORS.md).
- **Stable IDs** — `ids.memory(namespace, key)`, `ids.sourceMap(memoryId, key)`, `ids.textFeature(sourceMapId)`, etc. (`src/models/ids.ts`).

## Merge flow

`mergeMemory` (in `src/api/merge-memory.ts`):

1. `clearMemorySubtree` — remove old features, FTS/vec rows, source maps
2. Upsert memory + graph node/edge
3. Per content item: source map → lexical and/or vector features → content hash
4. Label assignments, edges, `syncMemorySearchMeta`, optional label-props search text
5. `appendProvenanceEvent` — linear hash chain

## Search

`search` runs lexical and vector arms (when the backend supports them), fuses with RRF (`src/rrf`), and optionally expands to graph neighbors. Namespace scoping supports subtree prefix, scope DAG, exact scope, or unscoped (capability-gated).

## Usage

```ts
import { MemoriesClient, namespacePath } from "@khoralabs/memories-core";
import { canonicalOntology } from "@khoralabs/memories-ontologies";
import { createMemoriesEmbeddingModel } from "@khoralabs/memories-core/helpers";

const client = new MemoriesClient(appOntology, { persistence });

await client.mergeMemory({
  namespace: namespacePath("app", "user-1"),
  key: "meeting-notes",
  kind: "node",
  content: [{ key: "summary", text: "Discussed launch timeline." }],
  labels: [{ kind: "fact", props: { statement: "Launch in Q3" } }],
});

const hits = await client.search({
  namespace: namespacePath("app", "user-1"),
  content: { text: "launch timeline" },
  topK: 10,
});
```

Async variants (`MemoriesClientAsync`, `mergeMemoryAsync`, `searchAsync`) mirror the sync API for remote or non-blocking backends. This repo ships the SQLite reference backend; implement `MemoriesPersistenceAsync` in your host if needed.

## Tests

From the repo root: `bun test packages/core`.
