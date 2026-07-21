# @khoralabs/memories-turso-serverless

Async [Memories](https://github.com/khoralabs/memories) persistence over [Turso Cloud](https://turso.tech) using `@tursodatabase/serverless`. Implements `MemoriesPersistenceAsync` with Turso-native full-text search (Tantivy FTS indexes) and vector search (`vector32`, `vector_distance_cos`).

Shared persistence semantics are documented in [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md). This README covers only the Turso serverless implementation details.

## Custodial service usage

Intended for **one Turso database per principal** in a custodial Memories Service:

1. Placement resolves `MemoriesDatabaseId` → Turso URL + auth token for that principal's database.
2. The service opens a lightweight serverless handle (no local SQLite file).
3. Use `mergeMemoryAsync`, `searchAsync`, and `deleteMemoryAsync` from `@khoralabs/memories-core` against the returned persistence instance.

Raw Turso tokens grant **database-level** access. Treat token handoff, rotation, and revocation as service/placement concerns.

## Quick start

```ts
import { createMemoriesTursoServerlessPersistence } from "@khoralabs/memories-turso-serverless";
import { mergeMemoryAsync } from "@khoralabs/memories-core";

const persistence = await createMemoriesTursoServerlessPersistence({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

await mergeMemoryAsync({
  persistence,
  namespace: "users/alice",
  key: "notes",
  sources: [{ sourceKey: "summary", text: "Meeting notes from Tuesday" }],
});
```

## Architecture

| Concern | Approach |
|--------|----------|
| Reads | `connect()` → `Connection.execute()` |
| Writes / transactions | `Connection.transaction()` on a dedicated write connection (parameterized statements) |
| Migrations | Idempotent `_schema_version` rows + compat `batch()` for DDL |
| Lexical search | `CREATE INDEX ... USING fts` on `text_features(text)`; query with `fts_match` / `fts_score` |
| Vector search | `vector32('[...]')` on insert; `vector_distance_cos` for scoped/unscoped queries |
| Graph / scopes | Same relational schema as the SQLite reference backend |

## Turso implementation notes

- This package opens remote Turso databases through `@tursodatabase/serverless`.
- It does not run local Turso Sync `pull()` / `push()`.
- Projection workflows should first provide an already-local Turso-family database, then use `@khoralabs/memories-projections-turso`.
- The custodial Memories Service should keep URL/token resolution outside this package.

## Migrations

```ts
import { migrateMemoriesTursoServerless, createTursoClients } from "@khoralabs/memories-turso-serverless";

const db = createTursoClients({ url, authToken });
await migrateMemoriesTursoServerless(db);
```

Schema is shared Turso-family DDL (reusable by a future `@khoralabs/memories-turso-sync` adapter).

## Future sync notes

Sovereign agents may later bootstrap a local Turso database from the same remote schema using `@tursodatabase/sync` (`pull()` / `push()`). Turso Sync last-push-wins semantics differ from Memories provenance semantics — coordinate writes accordingly.

## Testing

```sh
# Unit tests (no credentials)
bun test packages/persistence/turso-serverless

# Integration tests (requires disposable test DB)
export TURSO_DATABASE_URL="libsql://..."
export TURSO_AUTH_TOKEN="..."
bun test packages/persistence/turso-serverless
```

## Limitations

- Turso FTS has **no read-your-writes inside a transaction** — search after commit.
- **KNN** uses linear `vector_distance_cos` (`vectorKnnSearch: true`).
- **ANN** (`libsql_vector_idx` / `vector_top_k`) is attempted at open; if index create fails, `vectorAnnSearch` is `false` and ANN requests noop.
- Nested transactions are rejected.
- Compat `batch()` ignores bound parameters — transactional writes use `Connection.transaction()` instead.
