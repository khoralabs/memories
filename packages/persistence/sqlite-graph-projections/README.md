# @khoralabs/sqlite-graph-projections

Optional SQLite graph-study layer for memories: mean-pooled embeddings, UMAP 3D layout, and UI preview helpers. Depends on `@khoralabs/memories-sqlite` for the database handle and `@khoralabs/memories-core` for `MemoriesPersistence` graph reads.

Install only when you need graph visualization or study tooling (`umap-js` stays out of headless persistence hosts).

## Exports

- **Layout** — `buildNamespaceGraphLayout`, `buildNamespaceSubtreeGraphLayout`, `NamespaceGraphLayout`, UMAP helpers
- **Projections** — `loadMeanEmbeddingsForNamespace`, `loadMemoryTextPreview`, `loadSourceMapTextPreview`, `loadEdgePreview`
- **Facade** — `createMemoriesVisualization(db, persistence)`

## Usage

```ts
import { MemoriesClient } from "@khoralabs/memories-core";
import { canonicalOntology } from "@khoralabs/memories-ontologies";
import {
  createMemoriesPersistence,
  openMemoriesDatabaseReadonly,
} from "@khoralabs/memories-sqlite";
import {
  buildNamespaceGraphLayout,
  createMemoriesVisualization,
} from "@khoralabs/sqlite-graph-projections";

const db = openMemoriesDatabaseReadonly("memories.db");
const persistence = createMemoriesPersistence(db);
const client = new MemoriesClient(canonicalOntology, { persistence });

const layout = buildNamespaceGraphLayout(db, persistence, "app/user-1");
const viz = createMemoriesVisualization(db, persistence);
const preview = viz.loadMemoryTextPreview("app/user-1", "note-1");
```

Graph topology reads (`loadGraphEdgesForNamespace`, `loadGraphEdge`, …) remain on `MemoriesPersistence` in `@khoralabs/memories-sqlite`.
