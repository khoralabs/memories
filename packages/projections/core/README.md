# @khoralabs/memories-projections

Strategy-neutral graph projection code for Memories: source interfaces, layout math, UMAP 3D projection, and async visualization helpers.

## Exports

- `GraphProjectionSource` — storage adapter interface for namespace listing, mean embeddings, and text previews.
- `GraphProjectionGraphReads` — graph read shape consumed from `MemoriesPersistence` / `MemoriesPersistenceAsync`.
- `buildNamespaceGraphLayoutFromSource` — builds one namespace layout from a source and graph reads.
- `buildNamespaceSubtreeGraphLayoutFromSource` — builds a subtree layout with qualified `namespace::key` node ids.
- `createMemoriesVisualizationFromSource` — async facade for layout and preview calls.
- UMAP helpers and layout types: `NamespaceGraphLayout`, `GraphLayoutNode`, `GraphLayoutEdge`, `umap3DLayout`, `minMaxNormalize3D`.

## Usage

```ts
import {
  buildNamespaceGraphLayoutFromSource,
  type GraphProjectionSource,
} from "@khoralabs/memories-projections";

const source: GraphProjectionSource = createYourStrategySource(localDb);
const layout = await buildNamespaceGraphLayoutFromSource(source, persistence, "app/user-1");
```

## Strategy Boundary

This package does not open databases. Use a strategy package that matches the in-process persistence database shape:

- `@khoralabs/memories-projections-sqlite` for `@khoralabs/memories-sqlite`
- `@khoralabs/memories-projections-turso` for local Turso/libSQL databases

Sync/pull workflows are intentionally out of scope. Projection code expects the caller to provide an already-local projection source.

See [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md) before adding another strategy package.
