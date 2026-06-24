# Remote backends

Backend strategies beyond local SQLCipher files: libSQL/Turso, remote Memories nodes, and principal-registered endpoints for self-custody.

**Status:** Only `{ kind: "sqlite"; dataDir; sqlCipherKey? }` is implemented in `@khoralabs/memories-service-storage-sqlite`.

## Strategy model

The core type intentionally keeps one known branch plus an escape hatch:

```ts
type MemoriesDatabaseBackendStrategy =
  | { kind: "sqlite"; dataDir: string; sqlCipherKey?: string; capabilities?: Partial<MemoriesBackendCapabilities> }
  | { kind: string; capabilities?: Partial<MemoriesBackendCapabilities>; [key: string]: unknown };
```

New backends add packages that implement `MemoriesDatabaseBackend` + `MemoriesDatabaseBackendFactory` and register strategies through placement overrides or the default strategy. Set `capabilities` on the strategy so hosts and agents know what persistence features are available without opening a connection. Fields for remote/libSQL shapes stay in the open branch until use cases stabilize.

## libSQL / Turso

Local libSQL and hosted Turso are both "sqlite-shaped" persistence but not file-path hosting. Likely direction:

- New backend package (e.g. `storage-libsql`)
- Strategy fields: `url`, `authToken`, optional local replica path
- Same `MemoriesPersistence` surface via `@khoralabs/memories-sqlite` or a libSQL client adapter

Open questions: SQLCipher compatibility, vec extension support, backup semantics vs file backends.

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

1. libSQL backend package (if Turso/local libSQL is the next concrete need)
2. Remote HTTP persistence client + remote backend factory
3. Principal node registration and discovery (likely coupled with DID auth)
