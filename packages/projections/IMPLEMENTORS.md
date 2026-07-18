# Memory Projections Implementor's Guide

This document describes the contract for projection packages. Persistence semantics live in [`../persistence/IMPLEMENTORS.md`](../persistence/IMPLEMENTORS.md); projections are read-only helpers that turn an already-local memory store into graph layout and preview data.

## Package Roles

| Package | Role |
| --- | --- |
| `@khoralabs/memories-projections` | Strategy-neutral source interfaces, layout math, layout types, and async visualization facade. |
| `@khoralabs/memories-projections-contract` | Shared conformance tests for strategy adapters (`runMemoriesProjectionsContractTests`). |
| `@khoralabs/memories-projections-sqlite` | SQLite strategy adapter for `@khoralabs/memories-sqlite` table/blob layout. |
| `@khoralabs/memories-projections-libsql` | LibSQL strategy adapter for `@khoralabs/memories-libsql` (FTS5 + `vector32`). |
| `@khoralabs/memories-projections-turso` | Turso/libSQL strategy adapter for an already-local Turso-family database. |

Projection strategy must match the in-process persistence database shape. Do not auto-detect storage backends in the core package.

## Core Contract

Strategy packages adapt local storage into this source shape:

```ts
export type GraphProjectionSource = {
  listNamespacesUnderPrefix(prefix: string): Promise<string[]>;
  loadMeanEmbeddingsForNamespace(namespace: string): Promise<GraphMemoryEmbedding[]>;
  loadMemoryTextPreview(namespace: string, key: string, maxChars?: number): Promise<string | null>;
  loadSourceMapTextPreview(sourceMapId: string, maxChars?: number): Promise<string | null>;
};
```

Graph topology remains on `MemoriesPersistence` / `MemoriesPersistenceAsync` graph reads:

- `loadGraphEdgesForNamespace(namespace)`
- `loadNodeLabelsForNamespace(namespace)`
- `loadNodePropertiesForNamespace(namespace)`
- `loadGraphEdge(namespace, edgeId)` for preview facades

The core package combines source rows and graph reads through:

- `buildNamespaceGraphLayoutFromSource(source, persistence, namespace, options?)`
- `buildNamespaceSubtreeGraphLayoutFromSource(source, persistence, prefix, options?)`
- `collectNamespaceUmapInput(source, persistence, namespace, options?)`
- `buildNamespaceGraphLayoutFromUmapInput(input, options?)`
- `createMemoriesVisualizationFromSource(source, persistence)`

Use the `collect*UmapInput` helpers when a service node should run storage-local reads but an external worker should run UMAP. The collected input is JSON-safe and can be transported with `encodeUmapInput` / `decodeUmapInput`.

## Storage Adapter Rules

- Adapters must be read-only.
- Adapters must accept an already-local database/query handle.
- Adapters must not open remote databases, run sync, provision databases, or own credentials.
- Adapters should preserve namespace subtree semantics: namespace equals `prefix` or is nested under `prefix + "/"`.
- Adapters should exclude system source maps whose `source_key` matches GLOB `__*` (or equivalent) when computing user content mean embeddings. Prefer `NOT GLOB '__*'` over `NOT LIKE '__%'` — in SQL `LIKE`, `_` is a single-character wildcard.
- Adapters should mean-pool vectors per memory and skip malformed/incompatible vector rows rather than changing layout core behavior.

## SQLite Strategy

`@khoralabs/memories-projections-sqlite` wraps a `bun:sqlite` `Database`.

- Namespace listing delegates to `@khoralabs/memories-sqlite`.
- Vectors are stored as raw SQLite blobs and decoded with `blobToVector`.
- Text previews read `text_features` ordered by `_ts_created`, then `_id`.
- Sync convenience APIs can remain for SQLite callers, but the strategy must also expose `createSqliteGraphProjectionSource(db)`.

## LibSQL Strategy

`@khoralabs/memories-projections-libsql` wraps a local query client (e.g. `@libsql/client` `Client`).

- Pair with `@khoralabs/memories-libsql` for the matching table/`vector32` shape.
- The adapter reads vectors with `vector_extract(vf.vector) AS vector_json` and parses JSON arrays.
- Public APIs accept a minimal query client rather than credentials or file paths.
- Prefer a real `file:` database handle; private in-memory URLs are unreliable with interactive persistence transactions.

## Turso/libSQL Strategy

`@khoralabs/memories-projections-turso` wraps a local query client.

- The query client should be local/in-process. Remote Turso serverless access belongs in persistence/service workflows, not projections.
- The adapter reads vectors with `vector_extract(vf.vector) AS vector_json` and parses JSON arrays.
- The adapter must not call Turso Sync `pull()` or `push()`. A workflow may sync before creating the projection source.
- Public APIs should accept a minimal query client rather than Turso credentials.
- SQL is compatible with the libsql projections adapter on the shared Turso-family schema.

## Layout Core Rules

- Core layout code must not import `bun:sqlite`, Turso/libSQL clients, or strategy packages.
- Core layout code may depend on `@khoralabs/memories-persistence-core` types and `umap-js`.
- UMAP output should be deterministic by default through the seeded RNG.
- Layout positions are normalized to `[-1, 1]` per axis.
- Namespace subtree layouts qualify keys as `namespace::memoryKey` to avoid collisions.

## Testing

Use focused tests at the right layer:

- Core tests use fake `GraphProjectionSource` data and no database (layout/UMAP math).
- Cross-strategy behavioral conformance lives in [`@khoralabs/memories-projections-contract`](./contract): call `runMemoriesProjectionsContractTests(name, factory)` from each strategy package. The factory returns `{ source, persistence }` so the harness can seed with `mergeMemoryAsync` and assert namespaces, mean embeddings (including `__*` exclusion), previews, and layout smoke.
