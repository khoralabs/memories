# @khoralabs/memories-projections-turso

Turso/libSQL projection strategy for Memories.

This package expects an already-local, in-process Turso-family database with the `@khoralabs/memories-turso-serverless` table shape. It does not open remote serverless databases and does not run Turso Sync `pull()` or `push()`.

Vectors are read with `vector_extract(vector)` and parsed as JSON arrays before mean pooling.

## Exports

- `createTursoGraphProjectionSource(queryClient)` — adapts a local Turso/libSQL query handle into `GraphProjectionSource`.
- `loadMeanEmbeddingsForNamespace(queryClient, namespace)` — reads `vector_extract(vf.vector) AS vector_json`.
- `loadMemoryTextPreview(queryClient, namespace, key, maxChars?)`
- `loadSourceMapTextPreview(queryClient, sourceMapId, maxChars?)`
- `buildNamespaceGraphLayout(queryClient, persistence, namespace, options?)`
- `buildNamespaceSubtreeGraphLayout(queryClient, persistence, prefix, options?)`
- `createTursoMemoriesVisualization(queryClient, persistence)`

## Query Client Shape

```ts
type TursoProjectionQueryClient = {
  execute(
    statement: string | { sql: string; args?: readonly unknown[] },
    args?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
};
```

## Usage

```ts
import {
  buildNamespaceGraphLayout,
  createTursoGraphProjectionSource,
} from "@khoralabs/memories-projections-turso";

const source = createTursoGraphProjectionSource(localClient);
const layout = await buildNamespaceGraphLayout(localClient, persistence, "app/user-1");
```

## Turso Notes

- The query handle should point at an already-local Turso-family database.
- Pulling from Turso Cloud before projection is a workflow concern, not a package concern.
- Remote `url` / `authToken` handling belongs in persistence or service packages.
- Excludes system source maps whose `source_key` matches GLOB `__*` from mean embeddings.
- Skips malformed vector JSON rows.

Shared adapter rules are documented in [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md).
