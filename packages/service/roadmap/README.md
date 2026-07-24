# Roadmap

Feature plans for `@khoralabs/memories-service`. Current implementation reference: [`../spec.md`](../spec.md). Package overview: [`../README.md`](../README.md).

| Feature | Status |
|---------|--------|
| HTTP memory APIs + remote clients | Shipped |
| Ontology registry (phase 1) | Shipped |
| HTTP-safe contributor attribution | Shipped |
| Local SQLite / libSQL / Turso backends + composite factory | Shipped |
| Placement store (programmatic) | Shipped |
| Auth: `none`, `server-admin` | Shipped |
| [Decentralized principal auth](./decentralized-principal-auth.md) | Phase 1 shipped; `did-principal` + grants TBD |
| App policy auth | Not implemented |
| Placement admin HTTP API | Not implemented |
| Remote Memories node backend | Not implemented |
| Principal-registered nodes | Not implemented |
| Telemetry event ingest (`POST /telemetry/events`) | Not implemented (v1: in-process OTEL only; see [`../otel/README.md`](../otel/README.md)) |

---

## Shipped

### HTTP memory APIs and clients

Lifecycle, persistence, read, projection, and ontology routes via `@khoralabs/memories-service/http`. Remote clients in `@khoralabs/memories-service/client`: `RemoteMemoriesClientAsync`, `RemoteMemoriesReadClient`, `MemoriesOntologyClient`.

### Ontology registry (phase 1)

Content-addressed registry, per-database link history, HTTP routes, client helpers, host link-on-open pattern. Phase 2 (merge enforcement, runtime rehydration from stored JSON) is still open — see non-goals in [../spec.md](../spec.md).

### HTTP-safe contributor attribution

Server-side `khora.http-request-v1` attestations from authenticated actors (`MemoriesServiceHttpOptions.attribution`). Clients pass `intentSnapshotId` only; contributor spoofing is stripped. Formats live in `@khoralabs/memories-node/attestation`.

### Backends and placement

`MemoriesDatabaseBackendStrategy` named kinds:

```ts
type MemoriesDatabaseBackendStrategy =
  | { kind: "sqlite"; dataDir: string; sqlCipherKey?: string; capabilities?: ... }
  | { kind: "libsql"; dataDir: string; encryptionKey?: string; capabilities?: ... }
  | { kind: "turso-serverless"; url: string; authToken?: string; remoteEncryptionKey?: string; capabilities?: ... }
  | { kind: string; capabilities?: ...; [key: string]: unknown };
```

`createLocalSqliteServiceStack` (`@khoralabs/memories-service/storage/sqlite`) wires a composite factory for `sqlite`, `libsql`, and `turso-serverless`. Turso supports `open` / `exists` / `delete` / `close`; snapshot and list raise unsupported-storage-feature.

Placement is programmatic: `MemoriesDatabasePlacementStore` (`getDefaultStrategy`, `setDefaultStrategy`, `getStrategy`, `setStrategy`, `removeStrategy`, `listOverrides`) with SQLite registry at `{dataDir}/registry/placements.db`.

Backup and replication stay backend-specific; the service exposes capability metadata per strategy and does not define a cross-backend protocol.

---

## Planned

### App policy auth

Host-decided access. Shipped schemes today: `none`, `server-admin` (`@khoralabs/memories-service/auth`).

```text
MEMORIES_SERVICE_AUTH=app-policy
```

Proposed factory in auth:

```ts
type AppPolicyAuthStrategyOptions = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: {
    actor: AuthenticatedActor;
    action: DatabaseAction;
    database?: MemoriesDatabaseId;
    namespace?: string;
  }): Promise<void>;
};
```

The host supplies identity, team/org membership, and namespace rules; the service stays limited to opaque `{ kind, ownerKey }` ids and lifecycle. Mutually exclusive with `server-admin` and `did-principal` per instance. Env alone is insufficient — requires host wiring at server creation (`createAppPolicyAuthStrategy({ authenticate, authorize })`).

### Placement admin HTTP API

Programmatic placement works today; operators still need in-process calls or direct registry DB access. Proposed routes (paths and auth TBD):

```text
GET    /placement/default
PUT    /placement/default
GET    /placement/overrides?kind=
PUT    /placement/overrides
DELETE /placement/overrides
```

Bodies use the same `MemoriesDatabaseBackendStrategy` JSON as the placement store. Require `manage` (or stricter). Under `did-principal`, who may mutate placement is TBD. Extend the service client with placement methods once routes exist.

Also: validate that override strategies reference kinds the host has factories for; optionally refuse deleting the default without a replacement.

Non-goals: placement on the core service API; cross-service placement replication.

### Remote Memories node backend

A placement strategy that opens a client-backed `MemoriesPersistenceAsync` against another service:

```ts
{ kind: "remote"; endpoint: string; auth: ... }
```

Distinct from the shipped remote *HTTP clients* (callers talking to this service). Sidecars and WAL stay hidden. Order after that: principal node registration/discovery (resolve `database.ownerKey` to an authorized endpoint; registration signed by owner DID; coupled with [DID auth](./decentralized-principal-auth.md)). Placement store is the natural home for `{ id → remote strategy }` overrides once the admin API exists.

### Telemetry event ingest (phase 2)

v1 ships in-process aggregation only: pass `telemetry` from `@khoralabs/memories-otel` into `createMemoriesDatabaseService`. Networked nodes need a typed ingress so the service can enrich and re-export without embedding `otelcol`.

Proposed:

```text
POST /telemetry/events
```

Body: JSON array (or single object) matching the `MemoriesOpEvent` / `MemoriesDatabaseLifecycleEvent` catalog from `@khoralabs/memories-node/telemetry`. Auth: `manage` or a dedicated telemetry grant. Handler stamps `memories.database.*` from the authenticated database id (or body, when authorized) and calls `MemoriesTelemetry.emit*`.

Non-goals: full OTLP collector, multi-tenant routing UI, replacing the host’s OTel SDK/exporters. See [`../otel/README.md`](../otel/README.md).

### Decentralized principal auth

Phase 1 (attestation + HTTP attribution) is shipped. Remaining work — `did-principal` proofs, grants, portable credentials, revocation — is specified in [decentralized-principal-auth.md](./decentralized-principal-auth.md).
