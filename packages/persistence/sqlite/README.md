# @khoralabs/memories-sqlite

SQLite-backed implementation of the memories **persistence** contract (`MemoriesPersistence`): transactional merge/delete, hybrid lexical + vector search (with sqlite-vec), graph neighbors, and optional label-props search text. This is the **reference** store for parity with `@khoralabs/memories-core` and the Smithy persistence model.

## Exports

- **`createMemoriesPersistence(db, options?)`** — returns a sync `MemoriesPersistence` bound to a `bun:sqlite` `Database` opened with the memories schema (see `openMemoriesDatabase` in this package). Implements **`MemoriesGraph`** (reads + writes; topology reads are gated by `graphIndex`, default `true`).
- **Visualization / layout** — optional `createMemoriesVisualization` (mean embeddings + text/edge previews), `buildNamespaceGraphLayout` (UMAP + layout types in this package, using persistence + embedding SQL), and low-level `loadEdgePreview` / `loadMemoryTextPreview` / `loadMeanEmbeddingsForNamespace` helpers.
- **DB helpers** — `openMemoriesDatabase`, schema init, and related utilities for embedding / vec tables.

## Client usage

The sync **`MemoriesClient`** from `@khoralabs/memories-core` (not this package) takes `{ persistence }` where `persistence` is the object from `createMemoriesPersistence`. Async call sites that target Convex should use `@khoralabs/memories-convex` instead, which white-labels async APIs.

## Parity

Behavior is aligned with the shared row model and ops described in [`../IMPLEMENTORS.md`](../IMPLEMENTORS.md). For SQLite-specific merge/search/edge semantics, see [`IMPLEMENTORS.md`](./IMPLEMENTORS.md) in this package.

## Running tests (sqlite-vec / extension loading)

[`openMemoriesDatabase`](./src/connection.ts) loads **sqlite-vec**, which requires a SQLite build that supports **dynamic extension loading**. Bun’s bundled SQLite often does not; [`ensureCustomSqliteForExtensions`](./src/connection.ts) tries `SQLITE_CUSTOM_LIB`, Homebrew paths on macOS, and common distro paths on Linux before falling back to the default.

Root **`bun test`** also loads [`preload-sqlite-for-tests.ts`](../../../../scripts/preload-sqlite-for-tests.ts) via [`bunfig.toml`](../../../../bunfig.toml) so `ensureCustomSqliteForExtensions()` runs **before** any test opens `bun:sqlite`. Other tests use raw `new Database(":memory:")`; without preload, bundled SQLite loads first and later `Database.setCustomSQLite` fails with **SQLite already loaded**.

**If tests fail** with `dynamic extension loading` / `not support.*extension`:

1. **macOS (Homebrew):** `brew install sqlite`, then either export  
   `SQLITE_CUSTOM_LIB="$(brew --prefix sqlite)/lib/libsqlite3.dylib"`  
   before `bun test`, or run from the repo root:  
   `bun run test:with-sqlite`  
   (see root [`package.json`](../../../package.json)).

2. **Linux / CI:** Install your distro’s SQLite shared library (e.g. `libsqlite3-0` on Debian/Ubuntu), then set `SQLITE_CUSTOM_LIB` to the actual `.so` path if auto-discovery misses it (paths vary by architecture and distro).

3. See also **`SQLITE_CUSTOM_LIB`** in [`apps/matchmaking/.env.example`](../../../apps/matchmaking/.env.example).

Minimal CI images may need an explicit package install plus `SQLITE_CUSTOM_LIB`; sandboxed environments without a suitable `libsqlite3` will not pass tests that open this database.
