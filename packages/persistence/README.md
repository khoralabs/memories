# Memories Persistence

Persistence packages implement the storage side of `@khoralabs/memories-core`.

## Packages

| Package | Path | Role |
| --- | --- | --- |
| `@khoralabs/memories-persistence-core` | [`core/`](./core) | Shared persistence contracts, row schemas, stable IDs, namespace helpers, search payload types, and provenance hashing. |
| `@khoralabs/memories-sqlite` | [`sqlite/`](./sqlite) | Reference local SQLite backend using FTS5, sqlite-vec, graph tables, scopes, and provenance. |
| `@khoralabs/memories-turso-serverless` | [`turso-serverless/`](./turso-serverless) | Async Turso Cloud backend for remote single-tenant databases. |

## Shared Contract

Read [`IMPLEMENTORS.md`](./IMPLEMENTORS.md) for the storage contract, schema expectations, search semantics, graph behavior, capabilities, and transaction requirements shared by persistence implementations.

Projection packages live under [`../projections`](../projections). Library packages should depend on `@khoralabs/memories-projections` for strategy-neutral layout/source types and choose a storage-specific projection package only at the storage boundary.
