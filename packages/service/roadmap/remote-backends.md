# Remote backends

Backend strategies beyond local SQLCipher files: libSQL/Turso, remote Memories nodes, and principal-registered endpoints for self-custody.

## Strategy model

`MemoriesDatabaseBackendStrategy` is a discriminated union with one named branch per implemented backend plus an open escape hatch:

```ts
type MemoriesDatabaseBackendStrategy =
  | { kind: "sqlite"; dataDir: string; sqlCipherKey?: string; capabilities?: Partial<MemoriesBackendCapabilities> }
  | { kind: "turso-serverless"; url: string; authToken?: string; remoteEncryptionKey?: string; capabilities?: Partial<MemoriesBackendCapabilities> }
  | { kind: string; capabilities?: Partial<MemoriesBackendCapabilities>; [key: string]: unknown };
```

New backends add packages that implement `MemoriesDatabaseBackend` + `MemoriesDatabaseBackendFactory` and register strategies through placement overrides or the default strategy. Set `capabilities` on the strategy so hosts and agents know what persistence features are available without opening a connection.

## libSQL / Turso — implemented

`@khoralabs/memories-service-storage-turso-serverless` is implemented. The `turso-serverless` strategy kind is in the `MemoriesDatabaseBackendStrategy` union and the backend supports `open`, `exists`, `delete`, and `close`. Snapshot and list are not supported (unsupported-storage-feature).

### Gap: composite factory not wired in the service stack

`createLocalSqliteServiceStack` currently passes only `createLocalSqliteBackendFactory()` as the node backend factory. Placement overrides that point a database to `{ kind: "turso-serverless", ... }` will throw `UnknownBackendStrategyError` at runtime because there is no registered factory for that kind.

**Work needed:**

1. Change `createLocalSqliteServiceStack` (or add a new stack variant) to build a `createCompositeBackendFactory({ sqlite: ..., "turso-serverless": ... })` and use it as the resolver's factory.
2. Expose `createTursoServerlessBackendFactory` from `storage-turso-serverless` in the stack wiring (already exported from that package).
3. Add validation in the placement store / HTTP layer that an override strategy references a kind the host has a factory for (already noted in [placement-admin-api.md](./placement-admin-api.md)).

Once the composite factory is wired, operators can register turso-serverless overrides via `placement.setOverride` today, and through the HTTP admin API once [placement-admin-api.md](./placement-admin-api.md) ships.

## Remote Memories node

A backend that returns a client-backed `MemoriesPersistenceAsync` talking to another service over HTTP (or a future binary protocol).

Strategy sketch:

```ts
{ kind: "remote"; endpoint: string; auth: ... }
```

The remote node runs a compatible service protocol. Sidecars and WAL paths are hidden from the caller.

## Principal-registered nodes

Related to [decentralized-principal-auth.md](./decentralized-principal-auth.md): a principal registers its own Memories endpoint instead of using the operator's local storage.

This is service discovery, not the data plane:

- Resolve `database.ownerKey` to an authorized endpoint
- Advertise protocol version, auth scheme, credential/revocation metadata
- Registration signed by owner DID; registration alone is not authority

Use cases: data sovereignty, compliance boundaries, cost isolation, migration from hosted to self-hosted storage without changing database ids.

Placement store is the natural place to persist `{ id → remote strategy }` overrides once admin APIs exist. See [placement-admin-api.md](./placement-admin-api.md).

## Backup and replication

Stay backend-specific. The service may expose capability metadata per backend; it should not define one generic backup/replication protocol across file, libSQL, and remote backends.

## Implementation order

1. Wire composite backend factory in the service stack so turso-serverless placement overrides work (see Gap section above)
2. Remote HTTP persistence client + remote backend factory
3. Principal node registration and discovery (likely coupled with DID auth)
