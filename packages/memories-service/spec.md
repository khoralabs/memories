# Principal Database Service Research

## Context

Exedra currently owns a useful hosting pattern that is more general than the app itself: it manages many Memories SQLite databases, routes each request to the right database file, and derives local storage layout from a principal DID.

Today that logic lives in the Exedra app:

- `khora/apps/khoralabs/exedra/app/src/server/memories/store.ts` lazily opens and caches organization and account Memories databases with `openMemoriesDatabase()` and `createMemoriesPersistence()`.
- `khora/apps/khoralabs/exedra/app/src/server/storage/paths.ts` maps a principal kind and DID to a storage prefix and database filename.
- `khora/apps/khoralabs/exedra/app/src/server/memories/paths.ts` specializes that storage helper for organization and user memories.
- `khora/apps/khoralabs/exedra/app/src/server/memories/access.ts` and related route files keep authorization outside the Memories repo.

The Memories repo already has the right lower-level pieces:

- `@khoralabs/memories-core` defines the storage-agnostic `MemoriesPersistence` contract.
- `@khoralabs/memories-sqlite` opens SQLCipher-protected SQLite databases, configures WAL and sqlite-vec, and runs migrations.
- The repo does not currently define principals, DIDs, HTTP management, or a disk placement abstraction.

This note sketches how to extract Exedra's principal-database management pattern into reusable Memories packages without forcing every host to inherit Exedra's app model.

## Existing Exedra Pattern

The current local layout is:

```text
{EXEDRA_DATA_DIR}/memories/organizations/{orgDid}/{orgDid}.db
{EXEDRA_DATA_DIR}/memories/accounts/{accountDid}/{accountDid}.db
```

The raw DID is used for the folder and filename after validation that it is present and contains no path separators. The storage helper also produces object keys with the same shape for remote replication:

```text
{prefix}/organizations/{orgDid}/{orgDid}.db
{prefix}/accounts/{accountDid}/{accountDid}.db
```

Exedra has two routing layers:

- Database routing chooses the organization database or account database from a DID.
- Namespace routing chooses the in-database scope, such as an org, team, session, or personal namespace.

The reusable package should preserve that distinction. Database routing is a hosting concern. Namespace structure is application/domain concern layered on top of a chosen database.

## Proposed Package Split

### `@khoralabs/memories-service`

Server-side package that manages a fleet of Memories databases.

Responsibilities:

- Define database identity: database kind, opaque owner key, database id, sidecars.
- Resolve a database id to a storage location through an injected storage driver.
- Open and cache `MemoriesPersistence` instances.
- Apply lifecycle policy: create, open, close, evict, list, delete, compact, checkpoint.
- Expose a service API that can be called locally by a host server or remotely through HTTP.
- Stay pure with respect to access policy. Authorization belongs to the host, HTTP adapter, or an auth strategy wrapper.

Non-goals:

- Owning ontology design.
- Owning Exedra-specific team/session namespace builders.
- Owning DID authentication primitives directly.
- Owning grant storage or delegation semantics directly.
- Assuming every database lives on the same local filesystem.

### `@khoralabs/memories-service-http`

HTTP server adapter for `@khoralabs/memories-service`.

Responsibilities:

- Map HTTP requests to service methods.
- Validate request/response shapes.
- Select exactly one access strategy at startup and authorize requests before calling the pure service.
- Stream large exports/imports instead of buffering whole databases where possible.

This package can use `Bun.serve()` directly or export route handlers that a Bun host composes into its own server.

### `@khoralabs/memories-service-auth`

Reusable authorization strategies for the HTTP adapter.

Responsibilities:

- Define HTTP-facing auth strategy contracts and actor shapes.
- Provide `none`, `server-admin`, and DID request-signature strategies.
- Reuse the existing Khora/Relay DID request signature format and nonce-store pattern.
- Verify portable DID grant credentials and issuer-signed revocation logs.
- Keep auth dependencies out of the pure service package.

The pure `@khoralabs/memories-service` package should not depend on this package. The HTTP adapter may depend on it, or a host can provide its own strategy implementation.

### `@khoralabs/memories-service-client`

HTTP client package for remote administration and database access.

Responsibilities:

- Provide a typed client for service management APIs.
- Hide signing/header details behind an auth provider interface.
- Optionally expose a remote `MemoriesPersistenceAsync` implementation if we want core merge/search operations to run over HTTP.

There are two different client stories worth separating:

- Management client: create/list/delete/open/export databases and inspect metadata.
- Runtime persistence client: call memory search/merge/read APIs against a selected principal database.

The management client can be small at first. A full remote persistence implementation should be added only when a concrete host needs it.

## Service Model

The central identity can be small:

```ts
type DatabaseKind = "organization" | "account" | string;

type MemoriesDatabaseId = {
  kind: DatabaseKind;
  ownerKey: string;
};
```

`ownerKey` is intentionally opaque. Exedra can pass a DID as the owner key, but the service should not know that or derive semantics from it. Other hosts might pass account ids, tenant ids, project ids, UUIDs, hash ids, or externally assigned database handles.

The service should validate database ids before handing them to storage. It should also make filename encoding explicit and scheme-aware:

- Opaque encoded strategy: default. Encode `{kind, ownerKey}` into path-safe segments that do not depend on DID syntax.
- Compatibility strategy: reproduce Exedra's current readable DID layout for migration.
- Custom strategy: host supplies reversible or indexed mapping.

The encoded strategy must avoid collisions across schemes. A good default is to include a versioned scheme prefix and kind in the path, then use a normalized hash or base64url encoding of the owner key:

```text
v1/{kind}/{encodedOwnerKey}/{encodedOwnerKey}.db
```

or, if readability is less important:

```text
v1/{kind}/{sha256(ownerKey)}/{sha256(ownerKey)}.db
```

If hashes are used, the service should keep enough metadata to list databases and recover the original `ownerKey`, or require the caller to supply ids from an external registry.

The database manager can then be expressed as:

```ts
type MemoriesDatabaseService = {
  open(id: MemoriesDatabaseId): Promise<MemoriesPersistenceAsync>;
  exists(id: MemoriesDatabaseId): Promise<boolean>;
  list(filter?: { kind?: DatabaseKind }): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
  checkpoint(id: MemoriesDatabaseId): Promise<void>;
  close(id: MemoriesDatabaseId): Promise<void>;
};
```

The synchronous SQLite backend can still be used locally by wrapping it with the existing async adapter. Remote or node-backed stores can implement the async surface directly.

## HTTP Surface

A first HTTP adapter could expose only management and coarse memory operations:

```text
GET    /databases
PUT    /databases/:kind/:ownerKey
GET    /databases/:kind/:ownerKey
DELETE /databases/:kind/:ownerKey
POST   /databases/:kind/:ownerKey/checkpoint

POST   /databases/:kind/:ownerKey/memories/search
POST   /databases/:kind/:ownerKey/memories/merge
GET    /databases/:kind/:ownerKey/memories/graph?namespace=...
```

The path should not require raw owner keys. DIDs, UUIDs, and future schemes may create awkward URL escaping or ambiguous routing. A safer wire shape is:

```text
POST /databases/open
```

with `{ "kind": "account", "ownerKey": "did:key:..." }` in the body. The route path can stay stable even if the owner key syntax changes.

## Authorization Strategy Model

The database service should stay pure. It should open, cache, route, and manage databases, but it should not decide who is allowed to use them.

Authorization can sit one layer above the service:

```ts
type DatabaseAction = "read" | "write" | "manage";

type AuthenticatedActor = {
  scheme: string;
  subject: string;
  claims?: Record<string, unknown>;
};

type MemoriesDatabaseAccessStrategy = {
  authorize(input: {
    actor: AuthenticatedActor;
    action: DatabaseAction;
    database: MemoriesDatabaseId;
    namespace?: string;
  }): Promise<void>;
};
```

The HTTP adapter or host server should:

1. Authenticate the request.
2. Authorize `{ actor, action, database, namespace }` through the configured strategy.
3. Call `MemoriesDatabaseService` only after authorization succeeds.

This keeps grant complexity out of the database manager and lets embedded/local callers use the same pure service without an HTTP auth model.

The strategy implementations should live outside the pure service package. A small `@khoralabs/memories-service-auth` package is the right place for reusable implementations because DID verification, nonce stores, admin tokens, portable credentials, and revocation logs are HTTP/security concerns rather than database lifecycle concerns. The pure service can export only database ids and storage abstractions; the HTTP adapter can wire an access strategy around it.

The service host should choose the auth scheme from environment at startup. These schemes are mutually exclusive per service instance, because mixing them makes it harder to reason about who can read or mutate a database.

```text
MEMORIES_SERVICE_AUTH=none
MEMORIES_SERVICE_AUTH=server-admin
MEMORIES_SERVICE_AUTH=app-policy
MEMORIES_SERVICE_AUTH=did-principal
```

### No auth

Use `none` only for embedded, local, or test deployments where the caller already runs inside the trust boundary. The HTTP adapter should avoid exposing this mode on a public network.

### Server-level administration

With `server-admin`, if a client proves it administrates the service, it can manage and read/write every database.

This is useful for:

- First extraction from Exedra.
- Trusted internal tools.
- Deployment automation.
- Backup, migration, and repair jobs.

Possible mechanisms:

- Static bearer token, similar to Exedra's internal token.
- mTLS between trusted services.
- Signed admin requests using a configured server DID/key.

This should be the first supported authorization mode because it cleanly matches the management API and avoids prematurely designing delegation.

### Host app policy

With `app-policy`, the service delegates authorization to the embedding application. This is the Exedra-shaped mode: the Memories service only understands database ids, while Exedra decides whether the current user can read a namespace, write to a team/session scope, or manage an organization/account database.

This strategy is the right place for application concepts such as team membership, session participation, organization roles, and namespace-specific reads. Those concepts should not leak into `@khoralabs/memories-service`.

### DID-based principal auth

With `did-principal`, the auth strategy interprets `ownerKey` as a DID. A client can access a database if it proves control of the DID named by `database.ownerKey`, or if it presents a valid grant from that DID.

For `MemoriesDatabaseId { kind: "account", ownerKey }`, the request signer proves it controls `ownerKey` as a DID. For `kind: "organization"`, the signer either controls the organization DID directly or presents a grant issued by that DID.

Khora and Relay already have the right request-auth precedent:

- `@khoralabs/relay-contracts` defines `X-Agent-Did`, `X-Agent-Timestamp`, `X-Agent-Nonce`, and `X-Agent-Signature`.
- The signed message is `METHOD\nPATH\ntimestamp\nnonce\nsha256(body)`.
- `@khoralabs/relay-crypto` resolves `did:key` Ed25519 public keys from the DID itself.
- Relay and Khora both reject stale timestamps and nonce reuse with a nonce store.

The Memories DID strategy should reuse this shape unless there is a strong reason to diverge. That keeps the auth mental model consistent across the codebase and avoids inventing another signature envelope.

The strategy needs a verifier interface, not a hardcoded DID method:

```ts
type PrincipalProofVerifier = {
  verify(input: {
    expectedDid: string;
    method: string;
    request: Request;
  }): Promise<{ did: string; keyId?: string }>;
};
```

Important constraints:

- Prevent replay with timestamp, nonce, and request target binding.
- Bind the proof to the exact method, path, and body hash.
- Avoid making the owner key in the URL the source of truth when the signed payload says something else.

### DID grants

Grant complexity is only required in the DID-based strategy. Delegation is needed when one DID authorizes another principal or service to access its database. The grant should be explicit and scoped.

Possible grant shape:

```ts
type DidDatabaseGrant = {
  issuerDid: string;
  subjectDid: string;
  database: MemoriesDatabaseId;
  actions: Array<"read" | "write" | "manage">;
  namespaces?: string[];
  expiresAt?: string;
};
```

The grant issuer must match `database.ownerKey` or be an already-authorized administrator of that DID. The subject proves control of its own DID on each request, then presents the grant as authorization.

Open design choice for the DID strategy: grant storage can be embedded in the principal database, stored in a service-level registry, or verified as portable signed credentials.

- Embedded grants travel with the database but create a bootstrap problem for access to read the grant.
- Service-level grants are simple and fast but become part of server state outside the database file.
- Portable signed grants are attractive for remote nodes but require a stronger credential format and revocation story.

### Portable signed credentials

Portable signed credentials are the preferred long-term DID grant shape. The database owner signs a credential that names the subject DID, database id, allowed actions, optional namespaces, and expiry. The server does not need to store the grant to verify it; it only needs to verify the issuer signature and check revocation state.

```ts
type DidDatabaseGrantCredential = {
  credentialId: string;
  issuerDid: string;
  subjectDid: string;
  database: MemoriesDatabaseId;
  actions: Array<"read" | "write" | "manage">;
  namespaces?: string[];
  issuedAt: string;
  expiresAt?: string;
};
```

On each request, the DID strategy should verify:

- The request signer controls `subjectDid`.
- The credential signature verifies under `issuerDid`.
- `issuerDid` is authorized for `database.ownerKey`.
- The requested action and namespace are included.
- The credential is within its validity window.
- The credential has not been revoked.

The credential should be canonicalized before signing. The existing request signature format signs bytes derived from HTTP request data; grant credentials need an equivalent canonical JSON or typed binary representation so all nodes verify the same bytes.

### Issuer-signed revocation log

For portable credentials, revocation can be an append-only log signed by the issuer. The issuer publishes a monotonically ordered set of revocation events; any memory service node can cache and verify it independently.

```ts
type DidGrantRevocationEvent = {
  issuerDid: string;
  sequence: number;
  revokedCredentialId: string;
  revokedAt: string;
  reason?: string;
  previousEventHash?: string;
};
```

Each event should be signed by `issuerDid` and chained by hash. Verification checks:

- Every event signature verifies under the issuer DID.
- `sequence` increases without gaps for the issuer's log.
- `previousEventHash` matches the prior canonical event hash.
- The credential id is absent from the verified revoked set.

This gives immediate revocation without making grants service-local. It does introduce revocation distribution as an availability question: a node must know where to fetch the issuer's latest signed log, how fresh the cached copy must be, and whether to fail open or fail closed when the log is unavailable. For database access, fail closed is safer.

## Disk And Node Abstraction

The service should not equate "database" with "file on this machine." It should route through a storage driver.

```ts
type MemoriesDatabaseStorage = {
  resolve(id: MemoriesDatabaseId): Promise<DatabaseLocation>;
  list(filter?: { kind?: DatabaseKind }): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
};

type DatabaseLocation =
  | { kind: "local-sqlite-file"; filename: string; sqlCipherKey: string }
  | { kind: "remote-memories-node"; endpoint: URL; auth: RemoteNodeAuth }
  | { kind: "custom"; open: () => Promise<MemoriesPersistenceAsync> };
```

The local SQLite implementation can reproduce Exedra's folder layout. A remote-node implementation can return a client-backed persistence object. A custom implementation lets hosts bridge to object storage, replicated SQLite, or tenant-specific infrastructure.

Sidecars matter for SQLite. A local-file driver owns `*.db`, `*.db-wal`, and `*.db-shm` together. A remote-node driver should hide sidecars entirely.

Backup, restore, and replication should stay storage-driver-specific. The service can expose driver capability metadata, but it should not define one generic backup or replication protocol over local files, remote nodes, object storage, and future backends.

### Principal-registered nodes

In the DID-based strategy, a principal may want to register its own compatible Memories node instead of using the service operator's local storage. This is most useful when the principal wants to keep custody of the database while still participating in the same higher-level network.

The network-like substrate is not the data plane in this model. It is closer to DID-signed service discovery: a stable place to resolve a database owner to an authorized Memories endpoint, its supported protocol version, its auth scheme, and any credential or revocation-log metadata needed to use it safely.

Use cases:

- Data sovereignty: an organization keeps its memory database on infrastructure it controls, while granting selected apps or agents access through portable credentials.
- Compliance boundaries: a regulated team can require memories to stay in a specific region, cloud account, enclave, or audited environment.
- Availability ownership: a principal can run a node with its own uptime, backup, and replication choices without depending on the service operator's storage policy.
- Cost and scale isolation: heavy users can absorb their own storage and vector-search workload instead of concentrating all databases on one service.
- Interop and migration: a principal can move from hosted storage to self-hosted storage by changing the registered node endpoint while keeping the same database id and grant model.
- Discoverability: clients can resolve `database.ownerKey` to the principal's current node without manual endpoint configuration.
- Trust binding: the node registration can be signed by the owner DID, proving that the endpoint is authorized for that principal's memories.
- Credential routing: clients holding portable grants need a canonical endpoint where those grants should be presented.
- Revocation discovery: clients and remote nodes need a stable way to find the issuer's signed revocation log and freshness policy.
- Protocol negotiation: the registration can advertise compatible API versions, storage capabilities, provenance behavior, and supported auth modes.

A node registration should be a pointer, not authority by itself. The DID strategy still needs proof that the registering caller controls `database.ownerKey`, and callers still need request signatures plus owner-issued credentials. The registered node must advertise a compatible service protocol and enough verification material for clients to trust they are talking to the intended node.

This gives principals self-custody without losing interoperability. A hosted service can resolve and route to the principal's node, while the principal keeps control over storage, backup, replication, and grant issuance.

## Recommended Extraction Path

1. Extract Exedra's path helpers into a generic storage-layout module, using opaque owner keys by default and keeping raw DID layout only as an Exedra compatibility preset.
2. Add a local SQLite `MemoriesDatabaseStorage` and `MemoriesDatabaseService` in the Memories repo.
3. Move Exedra's open/cache behavior behind the service while leaving Exedra's namespace builders and authz policy in Exedra.
4. Add an HTTP management adapter that selects one auth strategy from environment at startup.
5. Add `@khoralabs/memories-service-auth` for reusable strategy implementations.
6. Ship `none`, `server-admin`, and `app-policy` strategies before DID-specific auth.
7. Add DID proof verification as a strategy implementation once the proof format is settled.
8. Add DID grants inside the DID strategy only after principal auth has a concrete consumer.
9. Add remote-node storage and principal node registration after the local service API has stabilized.

## Open Questions

- What should the default opaque owner-key encoding be: reversible base64url, hash plus metadata index, or host-provided mapping?
- Should DID grants be service-level metadata, database-local metadata, or portable signed credentials?
- Should HTTP expose fine-grained persistence operations, or should it expose higher-level memory APIs only?
- Should remote databases participate in provenance verification across nodes, or is each database's existing hash chain sufficient?

