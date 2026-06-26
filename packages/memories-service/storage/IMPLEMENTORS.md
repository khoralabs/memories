# Storage backend implementor's guide

This document describes the contract for adding a new storage backend to the Memories service. The relevant types live in `@khoralabs/memories-service`.

## Core interfaces

### `MemoriesDatabaseBackend`

```ts
type MemoriesDatabaseBackend = {
  readonly strategy: MemoriesDatabaseBackendStrategy;
  open(id: MemoriesDatabaseId): Promise<MemoriesDatabaseHandle>;
  exists(id: MemoriesDatabaseId): Promise<boolean>;
  list(filter?: DatabaseListFilter): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
  checkpoint(id: MemoriesDatabaseId): Promise<void>;
  close(id: MemoriesDatabaseId): Promise<void>;
};
```

### `MemoriesDatabaseBackendFactory`

```ts
type MemoriesDatabaseBackendFactory = {
  create(strategy: MemoriesDatabaseBackendStrategy): MemoriesDatabaseBackend;
};
```

The factory receives a raw `strategy` object from the placement store and should validate the `kind` before constructing the backend. Throw on an unexpected `kind` rather than silently ignoring it.

### `MemoriesDatabaseHandle`

```ts
type MemoriesDatabaseHandle = {
  persistence: MemoriesPersistenceAsync;
  close(): Promise<void>;
  checkpoint?(): Promise<void>;
  /** Present for SQLite backends; required for graph reads and sync mutations. */
  sqlite?: SqliteDatabaseContext;
};
```

- `persistence` is the opened async persistence instance for this database.
- `close()` releases the connection. The service's LRU cache calls this on eviction and explicit `close(id)`.
- `checkpoint?()` is optional; only meaningful for WAL-mode databases (SQLite). Turso and other backends can omit it or no-op.
- `sqlite` is only needed for backends that expose a raw `bun:sqlite` connection for host-owned local maintenance paths. Omit for remote backends.

## Method contracts

### `open(id)`

Open or create the database for `id`. Return a handle. The service caches the handle; `open` will not be called again for the same id while a handle is live.

For local backends (e.g. SQLite): create the file and directory if absent, run migrations, wrap in `MemoriesPersistenceAsync`.

For remote backends (e.g. Turso): establish a connection, run schema migrations, wrap in `MemoriesPersistenceAsync`. `createMemoriesTursoServerlessPersistence` from `@khoralabs/memories-turso-serverless` handles this.

### `exists(id)`

Return `true` if the database exists and has been initialized. Must not throw on a missing or unreachable database — return `false` instead. For remote backends, a connectivity error should return `false` rather than propagate.

### `list(filter?)`

Return all known database ids, optionally filtered by `filter.kind`. Backends that cannot enumerate their own databases (e.g. Turso with no Cloud Management API) should return `[]`. Databases placed via explicit placement overrides still appear in `resolver.list()` regardless, because the resolver merges the backend list with override ids from the placement store.

### `delete(id)`

Remove the database's data. **Data plane only:** do not remove placement or ontology registry entries — those are the control plane's responsibility. For local SQLite: delete the `.db`, `-wal`, and `-shm` files plus the containing directory. For remote Turso: `DELETE` all Memories tables in FK-safe order (see `turso-serverless-backend.ts`). Do not drop the remote database itself unless your deployment explicitly manages Turso Cloud provisioning.

### `checkpoint(id)`

Flush WAL to the main database file. No-op is acceptable for remote or non-WAL backends. For local SQLite: open the file, run `PRAGMA wal_checkpoint(TRUNCATE)`, close.

### `close(id)`

Backend-level close hook called by the service when it evicts or explicitly closes a handle. Most backends can implement this as a no-op if the handle's `close()` already handles cleanup.

## Strategy shape

Define your strategy type as a tagged union member:

```ts
type MyBackendStrategy = {
  kind: "my-backend";
  endpoint: string;
  apiKey?: string;
  capabilities?: Partial<MemoriesBackendCapabilities>;
};
```

Declare it in your factory's `create` validation. The strategy is serialized to JSON and stored in the placement registry; keep it JSON-safe (no functions, no non-serializable values).

## Capabilities

Attach a `capabilities` field to your strategy to declare what the opened database supports. `resolveStrategyCapabilities(strategy)` from `@khoralabs/memories-service` merges your declared overrides with the appropriate defaults:

- `sqlite` strategies default to `DEFAULT_SQLITE_STRATEGY_CAPABILITIES` (all flags on).
- `turso-serverless` strategies default to `DEFAULT_TURSO_SERVERLESS_STRATEGY_CAPABILITIES` (all flags on).
- All other `kind` values fall back to `DEFAULT_MEMORIES_BACKEND_CAPABILITIES` from `@khoralabs/memories-core` (lexical, vector, neighbor, graph, and multi-namespace on; **unscoped off**).

Override individual flags when your backend lacks a capability:

```ts
{
  kind: "my-backend",
  endpoint: "https://...",
  capabilities: { vectorSearch: false, unscopedSearch: false },
}
```

Hosts can read strategy capabilities before opening a database:

```ts
import { resolveStrategyCapabilities } from "@khoralabs/memories-service";

const caps = resolveStrategyCapabilities(strategy);
if (!caps.vectorSearch) { /* skip embed step */ }
```

## Registering with the composite factory

```ts
import { createCompositeBackendFactory } from "@khoralabs/memories-service";
import { createLocalSqliteBackendFactory } from "@khoralabs/memories-service-storage-sqlite";
import { createMyBackendFactory } from "@khoralabs/memories-service-storage-my-backend";

const factory = createCompositeBackendFactory({
  sqlite: createLocalSqliteBackendFactory(),
  "my-backend": createMyBackendFactory(),
});
```

Pass `factory` to `createBackendResolver`. The composite routes each strategy by its `kind` field.

## Placement store

The placement store is separate from the node backend. If you need a custom control plane (e.g. a remote database for multi-node deployment), implement `MemoriesDatabasePlacementStore` from `@khoralabs/memories-service`:

```ts
type MemoriesDatabasePlacementStore = {
  getDefaultStrategy(): Promise<MemoriesDatabaseBackendStrategy>;
  setDefaultStrategy(strategy: MemoriesDatabaseBackendStrategy): Promise<void>;
  getStrategy(id: MemoriesDatabaseId): Promise<MemoriesDatabaseBackendStrategy | undefined>;
  setStrategy(id: MemoriesDatabaseId, strategy: MemoriesDatabaseBackendStrategy): Promise<void>;
  removeStrategy(id: MemoriesDatabaseId): Promise<void>;
  listOverrides(filter?: { kind?: DatabaseKind }): Promise<
    Array<{ id: MemoriesDatabaseId; strategy: MemoriesDatabaseBackendStrategy }>
  >;
};
```

The SQLite implementation in `@khoralabs/memories-service-storage-sqlite` is the reference. A new placement store can route principals to any registered backend — it does not need to match the backend it controls.

## Ontology store

Similarly, implement `MemoriesDatabaseOntologyStore` from `@khoralabs/memories-service` if you need a custom ontology registry. The SQLite implementation stores ontologies at `{dataDir}/registry/ontologies.db`. The store is append-only: `registerOntology` uses `INSERT OR IGNORE` (content-addressed by SHA-256 hash), and `linkDatabase` appends links.

## Reference implementations

| Backend | Source | Notes |
|---------|--------|-------|
| SQLite | [`sqlite/src/local-sqlite-backend.ts`](./sqlite/src/local-sqlite-backend.ts) | Local file, WAL, SQLCipher, full `MemoriesBackendHandle.sqlite` context |
| Turso serverless | [`turso-serverless/src/turso-serverless-backend.ts`](./turso-serverless/src/turso-serverless-backend.ts) | Remote, async, no `sqlite` context, `list()` returns `[]` |
