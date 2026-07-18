# Memories Service — Storage Backends

Storage contracts and node-level backends for the Memories database service. Each backend package maps a placement strategy `kind` to an opened `MemoriesDatabaseHandle`.

## Packages

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-service-storage-core` | [`core/`](./core) | Shared storage contracts, strategies, placement/ontology stores, owner-key helpers, and snapshot artifact types. |
| `@khoralabs/memories-service-storage-contract` | [`contract/`](./contract) | Shared conformance tests for backends, placement stores, and ontology stores. |
| `@khoralabs/memories-service-storage-sqlite` | [`sqlite/`](./sqlite) | Local SQLCipher file backend, SQLite placement registry, and SQLite ontology registry. |
| `@khoralabs/memories-service-storage-libsql` | [`libsql/`](./libsql) | Local libSQL file backend (`dataDir` + encoded paths, optional `encryptionKey`). Data plane only. |
| `@khoralabs/memories-service-storage-turso-serverless` | [`turso-serverless/`](./turso-serverless) | Turso Cloud remote backend factory. Node data plane only — uses an external placement registry. |

## Concepts

**Control plane** (registries) and **node data plane** (backends) are intentionally separate:

- The **placement registry** (`MemoriesDatabasePlacementStore`) records which strategy each principal's database uses. The contract lives in `@khoralabs/memories-service-storage-core`; the SQLite package ships one implementation.
- The **ontology registry** (`MemoriesDatabaseOntologyStore`) stores content-addressed JSON Schemas. The contract lives in storage-core; the SQLite package ships one implementation.
- A **node backend** (`MemoriesDatabaseBackend`) opens, lists, deletes, checkpoints, and snapshots individual databases. Each backend package implements one.

A SQLite-backed control plane can route individual principals to Turso, libSQL, or any registered backend — using `createCompositeBackendFactory` from `@khoralabs/memories-service`.

## Adding a new backend

Read [`IMPLEMENTORS.md`](./IMPLEMENTORS.md) for the full backend contract, method semantics, handle shape, and capability declaration.
