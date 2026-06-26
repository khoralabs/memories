# Memories Service — Storage Backends

Node-level storage backends for the Memories database service. Each package maps a placement strategy `kind` to an opened `MemoriesDatabaseHandle`.

## Packages

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-service-storage-sqlite` | [`sqlite/`](./sqlite) | Local SQLCipher file backend, SQLite placement registry, and SQLite ontology registry. |
| `@khoralabs/memories-service-storage-turso-serverless` | [`turso-serverless/`](./turso-serverless) | Turso Cloud remote backend factory. Node data plane only — uses an external placement registry. |

## Concepts

**Control plane** (registries) and **node data plane** (backends) are intentionally separate:

- The **placement registry** (`MemoriesDatabasePlacementStore`) records which strategy each principal's database uses. The SQLite package ships one; others can supply their own.
- The **ontology registry** (`MemoriesDatabaseOntologyStore`) stores content-addressed JSON Schemas. The SQLite package ships one; others can supply their own.
- A **node backend** (`MemoriesDatabaseBackend`) opens, lists, deletes, and checkpoints individual databases. Each package here implements one.

A SQLite-backed control plane can route individual principals to Turso backends — or any combination — using `createCompositeBackendFactory` from `@khoralabs/memories-service`.

## Adding a new backend

Read [`IMPLEMENTORS.md`](./IMPLEMENTORS.md) for the full backend contract, method semantics, handle shape, and capability declaration.
