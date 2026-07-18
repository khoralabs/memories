# @khoralabs/memories-projections-libsql

LibSQL projection strategy for Memories.

This package expects an already-local, in-process libSQL database with the `@khoralabs/memories-libsql` table shape. It does not open remote databases, own credentials, or run sync.

Vectors are read with `vector_extract(vector)` and parsed as JSON arrays before mean pooling.

## Exports

- `createLibsqlGraphProjectionSource(queryClient)` — adapts a local libSQL query handle into `GraphProjectionSource`.
- `loadMeanEmbeddingsForNamespace(queryClient, namespace)` — reads `vector_extract(vf.vector) AS vector_json`.
- `loadMemoryTextPreview(queryClient, namespace, key, maxChars?)`
- `loadSourceMapTextPreview(queryClient, sourceMapId, maxChars?)`
- `buildNamespaceGraphLayout(queryClient, persistence, namespace, options?)`
- `buildNamespaceSubtreeGraphLayout(queryClient, persistence, prefix, options?)`
- `createLibsqlMemoriesVisualization(queryClient, persistence)`

## Query Client Shape

```ts
type LibsqlProjectionQueryClient = {
  execute(
    statement: string | { sql: string; args?: readonly unknown[] },
    args?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
};
```

`@libsql/client` `Client` satisfies this shape.

## Usage

```ts
import { createLibsqlDatabase, createMemoriesLibsqlPersistence } from "@khoralabs/memories-libsql";
import {
  buildNamespaceGraphLayout,
  createLibsqlGraphProjectionSource,
} from "@khoralabs/memories-projections-libsql";

const db = createLibsqlDatabase({ url: "file:./data.db" });
const persistence = await createMemoriesLibsqlPersistence({ db });
const source = createLibsqlGraphProjectionSource(db.client);
const layout = await buildNamespaceGraphLayout(db.client, persistence, "app/user-1");
```

## Notes

- Pair with `@khoralabs/memories-libsql` for the matching persistence schema.
- Excludes system source maps whose `source_key` matches GLOB `__*` from mean embeddings.
- Skips malformed vector JSON rows.

Shared adapter rules are documented in [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md).
