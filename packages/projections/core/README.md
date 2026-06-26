# @khoralabs/memories-projections

Strategy-neutral graph projection code for Memories: source interfaces, layout math, UMAP 3D projection, and async visualization helpers.

## Exports

- `GraphProjectionSource` — storage adapter interface for namespace listing, mean embeddings, and text previews.
- `GraphProjectionGraphReads` — graph read shape consumed from `MemoriesPersistence` / `MemoriesPersistenceAsync`.
- `buildNamespaceGraphLayoutFromSource` — builds one namespace layout from a source and graph reads.
- `buildNamespaceSubtreeGraphLayoutFromSource` — builds a subtree layout with qualified `namespace::key` node ids.
- `collectNamespaceUmapInput` / `collectNamespaceSubtreeUmapInput` — run storage-local reads and return JSON-safe UMAP input rows without running UMAP.
- `encodeUmapInput` / `decodeUmapInput` / `validateUmapInput` — optional gzip transport helpers for sending UMAP input to workers.
- `buildNamespaceGraphLayoutFromUmapInput` — run UMAP from a collected input payload.
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

For worker-based projection, split the pipeline:

```ts
import {
  buildNamespaceGraphLayoutFromUmapInput,
  collectNamespaceUmapInput,
  decodeUmapInput,
  encodeUmapInput,
} from "@khoralabs/memories-projections";

// service/storage-local process
const input = await collectNamespaceUmapInput(source, persistence, "app/user-1");
const payload = await encodeUmapInput(input, { compression: "gzip" });

// external worker process
const decoded = await decodeUmapInput(payload, { compression: "gzip" });
const layout = buildNamespaceGraphLayoutFromUmapInput(decoded);
```

## Strategy Boundary

This package does not open databases. Use a strategy package that matches the in-process persistence database shape:

- `@khoralabs/memories-projections-sqlite` for `@khoralabs/memories-sqlite`
- `@khoralabs/memories-projections-turso` for local Turso/libSQL databases

Sync/pull workflows are intentionally out of scope. Projection code expects the caller to provide an already-local projection source.

See [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md) before adding another strategy package.
