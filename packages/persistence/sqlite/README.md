# @khoralabs/memories-sqlite

SQLite-backed implementation of the memories **persistence** contract (`MemoriesPersistence`): transactional merge/delete, hybrid lexical + vector search (with sqlite-vec), graph neighbors, and optional label-props search text. This is the **reference** store for parity with `@khoralabs/memories-core` and the Smithy persistence model.

## Exports

- **`createMemoriesPersistence(db, options?)`** — returns a sync `MemoriesPersistence` bound to a `bun:sqlite` `Database` opened with the memories schema (see `openMemoriesDatabase` in this package). Implements **`MemoriesGraph`** (reads + writes; topology reads are gated by `graphIndex`, default `true`).
- **DB helpers** — `openMemoriesDatabase`, `openMemoriesDatabaseReadonly`, `openTestMemoriesDatabase`, `ensureCustomSqliteForExtensions`, `blobToVector`, schema init, and vec table utilities.

Graph study / UMAP layout / UI previews live in [`@khoralabs/sqlite-graph-projections`](../sqlite-graph-projections) (optional; pulls in `umap-js`).

## Client usage

The sync **`MemoriesClient`** from `@khoralabs/memories-core` (not this package) takes `{ persistence }` where `persistence` is the object from `createMemoriesPersistence`.

```ts
import { MemoriesClient } from "@khoralabs/memories-core";
import { canonicalOntology } from "@khoralabs/memories-ontologies";
import {
  createMemoriesPersistence,
  openMemoriesDatabase,
} from "@khoralabs/memories-sqlite";

const db = openMemoriesDatabase("memories.db", { sqlCipherKey: process.env.DB_KEY! });
const persistence = createMemoriesPersistence(db);
const client = new MemoriesClient(canonicalOntology, { persistence });
```

For async backends, implement `MemoriesPersistenceAsync` in your host and use `MemoriesClientAsync` from core.

## Parity

Behavior is aligned with the shared row model and ops described in [`IMPLEMENTORS.md`](./IMPLEMENTORS.md). The Smithy wire model lives in [`packages/spec/model/persistence.smithy`](../../spec/model/persistence.smithy).

## Running tests (sqlite-vec / extension loading)

[`openMemoriesDatabase`](./src/connection.ts) loads **sqlite-vec**, which requires a SQLite build that supports **dynamic extension loading**. Bun’s bundled SQLite often does not; [`ensureCustomSqliteForExtensions`](./src/connection.ts) tries `SQLITE_CUSTOM_LIB`, Homebrew paths on macOS, and common distro paths on Linux before falling back to the default.

**Important:** call `ensureCustomSqliteForExtensions()` **before** any code opens `bun:sqlite`. Once Bun loads its bundled SQLite, `Database.setCustomSQLite` fails with “SQLite already loaded”.

**If tests fail** with `dynamic extension loading` / `not support.*extension`:

1. **macOS (Homebrew):** `brew install sqlite`, then export before `bun test`:
   ```bash
   export SQLITE_CUSTOM_LIB="$(brew --prefix sqlite)/lib/libsqlite3.dylib"
   bun test
   ```

2. **Linux / CI:** Install your distro’s SQLite shared library (e.g. `libsqlite3-0` on Debian/Ubuntu), then set `SQLITE_CUSTOM_LIB` to the actual `.so` path if auto-discovery misses it.

Minimal CI images may need an explicit package install plus `SQLITE_CUSTOM_LIB`; sandboxed environments without a suitable `libsqlite3` will not pass tests that open this database.
