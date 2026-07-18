# @khoralabs/memories-libsql

Async [Memories](https://github.com/khoralabs/memories) persistence over [`@libsql/client`](https://www.npmjs.com/package/@libsql/client). Implements `MemoriesPersistenceAsync` with FTS5 lexical search, native `vector32` / `vector_distance_cos` vector search, and optional at-rest encryption for local `file:` databases.

Shared persistence semantics are documented in [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md). This README covers only the LibSQL implementation details.

## Quick start

```ts
import { createMemoriesLibsqlPersistence } from "@khoralabs/memories-libsql";
import { mergeMemoryAsync } from "@khoralabs/memories-core";

const persistence = await createMemoriesLibsqlPersistence({
  url: "file:./data.db",
  encryptionKey: process.env.MEMORIES_DB_KEY, // optional local encryption
});

await mergeMemoryAsync({
  persistence,
  namespace: "users/alice",
  key: "notes",
  sources: [{ sourceKey: "summary", text: "Meeting notes from Tuesday" }],
});
```

Remote Turso / libSQL URLs also work (`url` + `authToken`).

## Architecture

| Concern | Approach |
|--------|----------|
| Client | `createClient({ url, authToken?, encryptionKey? })` |
| Transactions | Interactive `client.transaction("write")` (nested txs rejected) |
| Migrations | Idempotent `_schema_version` rows + `batch()` for DDL |
| Lexical search | FTS5 virtual table `text_features_fts` (porter); query with `MATCH` / `bm25` |
| Vector search | `vector32('[...]')` on insert; linear `vector_distance_cos` for queries |
| Encryption | Pass `encryptionKey` through to the client — no SQLCipher / sqlite-crypto |
| Graph / scopes | Same relational schema as the SQLite / Turso serverless backends |

## Contrast with other backends

| Backend | Lexical | Vectors | Encryption |
|--------|---------|---------|------------|
| `@khoralabs/memories-sqlite` | FTS5 | sqlite-vec ANN | `@khoralabs/sqlite-crypto` |
| `@khoralabs/memories-turso-serverless` | Tantivy FTS index | `vector_distance_cos` | Turso remote encryption |
| `@khoralabs/memories-libsql` | FTS5 | `vector_distance_cos` | Client `encryptionKey` on `file:` |

## Migrations

```ts
import { createLibsqlDatabase, migrateMemoriesLibsql } from "@khoralabs/memories-libsql";

const db = createLibsqlDatabase({ url: "file:./data.db", encryptionKey });
await migrateMemoriesLibsql(db);
```

## Testing

```sh
bun test packages/persistence/libsql
```

Contract tests use a unique temp `file:` database.

## Limitations

- Vector ANN (`vector_top_k` / `libsql_vector_idx`) is not required; queries use linear `vector_distance_cos`.
- Contract tests use a unique temp `file:` database (`file::memory:` is unreliable with interactive transactions).
- Nested transactions are rejected.
- Local encryption applies to `file:` URLs.
