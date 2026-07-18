# Memories Projections

Projection packages provide read-only graph layout and preview helpers for Memories stores.

## Packages

| Package | Path | Role |
| --- | --- | --- |
| `@khoralabs/memories-projections` | [`core/`](./core) | Strategy-neutral source interfaces, layout math, layout types, and visualization facade. |
| `@khoralabs/memories-projections-contract` | [`contract/`](./contract) | Shared conformance tests (`runMemoriesProjectionsContractTests`) for strategy adapters. |
| `@khoralabs/memories-projections-sqlite` | [`sqlite/`](./sqlite) | SQLite adapter for local `@khoralabs/memories-sqlite` databases. |
| `@khoralabs/memories-projections-libsql` | [`libsql/`](./libsql) | LibSQL adapter for local `@khoralabs/memories-libsql` databases. |
| `@khoralabs/memories-projections-turso` | [`turso/`](./turso) | Turso/libSQL adapter for already-local Turso-family databases. |

## Strategy Matching

Projection strategy must match the persistence database shape:

- SQLite persistence uses `@khoralabs/memories-projections-sqlite`.
- Local libSQL / `@khoralabs/memories-libsql` uses `@khoralabs/memories-projections-libsql`.
- Local Turso-family handles use `@khoralabs/memories-projections-turso` (SQL-compatible with libsql projections on the same schema shape).
- Library code that only needs types or layout contracts should depend on `@khoralabs/memories-projections`.

Projection packages do not run persistence mutations. They read an already-local database/query handle and combine storage rows with graph reads from `MemoriesPersistence` or `MemoriesPersistenceAsync`.

## Implementing a Strategy

Read [`IMPLEMENTORS.md`](./IMPLEMENTORS.md) for the source contract, adapter boundaries, storage-specific rules, and testing expectations.
