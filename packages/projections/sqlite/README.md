# @khoralabs/memories-projections-sqlite

SQLite projection strategy for Memories. Use this package when the in-process persistence database is `@khoralabs/memories-sqlite`.

The strategy reads SQLite vector blobs with `@khoralabs/memories-sqlite` decoding and delegates storage-neutral layout math to `@khoralabs/memories-projections`.

## Exports

- `createSqliteGraphProjectionSource(db)` — adapts a `bun:sqlite` `Database` into `GraphProjectionSource`.
- `loadMeanEmbeddingsForNamespace(db, namespace)` — SQLite blob-backed mean embeddings.
- `loadMemoryTextPreview(db, namespace, key, maxChars?)`
- `loadSourceMapTextPreview(db, sourceMapId, maxChars?)`
- `buildNamespaceGraphLayout(db, persistence, namespace, options?)` — sync SQLite convenience wrapper.
- `buildNamespaceSubtreeGraphLayout(db, persistence, prefix, options?)` — sync SQLite subtree wrapper.
- `createMemoriesVisualization(db, persistence)` — sync SQLite preview facade.

## Usage

```ts
import { createMemoriesPersistence, openMemoriesDatabaseReadonly } from "@khoralabs/memories-sqlite";
import {
  buildNamespaceGraphLayout,
  createSqliteGraphProjectionSource,
} from "@khoralabs/memories-projections-sqlite";

const db = openMemoriesDatabaseReadonly("memories.db");
const persistence = createMemoriesPersistence(db);

const source = createSqliteGraphProjectionSource(db);
const layout = buildNamespaceGraphLayout(db, persistence, "app/user-1");
```

## SQLite Notes

- Reads `vector_features.vector` as raw `Float32Array` blobs through `blobToVector`.
- Excludes system source maps whose `source_key` starts with `__` from mean embeddings.
- Uses `listNamespacesUnderPrefix(db, prefix)` from `@khoralabs/memories-sqlite` for subtree layouts.
- Does not mutate the database.

Shared adapter rules are documented in [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md).
