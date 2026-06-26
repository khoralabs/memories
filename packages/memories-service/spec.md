# Memories Service

Reusable packages for managing many Memories databases per principal: route requests to the right database, cache open connections, and keep authorization outside the core service.

## Packages

| Package | Role |
|---------|------|
| `@khoralabs/memories-service` | Backend-agnostic database lifecycle: ids, validation, placement interfaces, resolver, LRU connection cache |
| `@khoralabs/memories-service-storage-sqlite` | Local SQLCipher file backend, SQLite placement registry, and ontology registry |
| `@khoralabs/memories-service-http` | HTTP adapter (lifecycle, persistence, reads, ontology) |
| `@khoralabs/memories-service-auth` | HTTP auth strategies (`none`, `server-admin`) |
| `@khoralabs/memories-service-client` | Management HTTP client, remote `MemoriesClientAsync`, read client, ontology helpers |

The core service depends only on `@khoralabs/memories-core` and `lru-cache`. SQLite and HTTP auth live in sibling packages.

## Database identity

```ts
type DatabaseKind = "organization" | "account" | string;

type MemoriesDatabaseId = {
  kind: DatabaseKind;
  ownerKey: string;
};
```

`ownerKey` is opaque. Hosts can pass DIDs, tenant ids, UUIDs, or external handles. The service validates ids but does not interpret owner-key semantics.

### File layout

The default sqlite backend encodes the full database id reversibly and writes flat versioned paths:

```text
{dataDir}/v1/{base64url([kind, ownerKey])}/database.db
```

`kind` is logical identity and filter metadata for the service API, not a storage grouping on disk.

Helpers live in `@khoralabs/memories-service`: `createReversibleOwnerKeyEncoder()`, `resolveEncodedDatabasePath()`, `OWNER_KEY_ENCODING_VERSION`.

## Backend and placement

The service routes each database id to a per-node backend through a resolver and placement
store. The placement/ontology registries are the **control plane**; the selected
backend strategy is the **node data plane**. These are intentionally independent:
a SQLite-backed registry can place nodes on SQLite or Turso, and a future
Turso-backed registry should be able to do the same.

```ts
import type { MemoriesBackendCapabilities } from "@khoralabs/memories-core/persistence";

type StrategyCapabilities = Partial<MemoriesBackendCapabilities>;

type MemoriesDatabaseBackendStrategy =
  | { kind: "sqlite"; dataDir: string; sqlCipherKey?: string; capabilities?: StrategyCapabilities }
  | { kind: string; capabilities?: StrategyCapabilities; [key: string]: unknown };

type MemoriesDatabaseBackend = {
  readonly strategy: MemoriesDatabaseBackendStrategy;
  open(id: MemoriesDatabaseId): Promise<MemoriesDatabaseHandle>;
  exists(id: MemoriesDatabaseId): Promise<boolean>;
  list(filter?: { kind?: DatabaseKind }): Promise<MemoriesDatabaseId[]>;
  delete(id: MemoriesDatabaseId): Promise<void>;
  checkpoint(id: MemoriesDatabaseId): Promise<void>;
  close(id: MemoriesDatabaseId): Promise<void>;
};

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

type MemoriesDatabaseBackendResolver = {
  resolve(id: MemoriesDatabaseId): Promise<MemoriesDatabaseBackend>;
  list(filter?: { kind?: DatabaseKind }): Promise<MemoriesDatabaseId[]>;
};
```

Each strategy advertises what its opened database supports: hybrid search arms, graph index reads, multi-namespace search, unscoped search, as-of search, and so on. The shape matches `MemoriesPersistence.capabilities` from `@khoralabs/memories-core`. Omitted keys resolve via `resolveStrategyCapabilities(strategy)` — sqlite defaults to the full `@khoralabs/memories-sqlite` feature set; other kinds fall back to core defaults unless overridden.

Hosts can read placement strategies before opening a database to decide whether agent workloads (vector search, graph expansion, integrator merges) are viable on that backend.

Mixed node strategies are enabled by a composite backend factory:

```ts
const factory = createCompositeBackendFactory({
  sqlite: createLocalSqliteBackendFactory(),
  "turso-serverless": createTursoServerlessBackendFactory(),
});
```

Resolver behavior:

1. Read per-principal override from `placement.getStrategy(id)`
2. Fall back to `placement.getDefaultStrategy()`
3. Return a backend from `factory.create(strategy)`, cached by canonical strategy JSON

`resolver.list(filter)` merges databases from the default backend, non-default override backends, and explicit placement override ids (deduplicated by `{ kind, ownerKey }`).

The registry implementation should not determine the node strategy set. A deployment may
use SQLite registries with mixed SQLite/Turso nodes today, and later replace the
registry/control plane with Turso while keeping the same per-node strategy model.

Backup, restore, and replication stay backend-specific. The service does not define a generic protocol across heterogeneous backends.

## Ontology registry

Clients can register per-database ontologies as valid JSON Schema documents. The registry is separate from placement (where data lives) and from the per-database label catalog (what merge has materialized inside a `.db` file).

```ts
type StoredOntologyJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  type: "object";
  properties: {
    nodeLabels: { type: "object"; additionalProperties: false; properties: Record<string, Record<string, unknown>> };
    edgeLabels: { type: "object"; additionalProperties: false; properties: Record<string, Record<string, unknown>> };
  };
  required: ["nodeLabels", "edgeLabels"];
  additionalProperties: false;
};

type MemoriesDatabaseOntologyStore = {
  registerOntology(schema: StoredOntologyJsonSchema): Promise<{ hash: string }>;
  getOntology(hash: string): Promise<StoredOntologyJsonSchema | undefined>;
  linkDatabase(id: MemoriesDatabaseId, hash: string): Promise<void>;
  getCurrentLink(id: MemoriesDatabaseId): Promise<{ hash: string; linkedAtMs: number } | undefined>;
  listLinkHistory(id: MemoriesDatabaseId): Promise<Array<{ hash: string; linkedAtMs: number; linkId: number }>>;
  listDatabasesByOntologyHash(hash: string): Promise<MemoriesDatabaseId[]>;
  listDatabasesByLabelKinds(filter?: { nodeKinds?: string[]; edgeKinds?: string[] }): Promise<MemoriesDatabaseId[]>;
};
```

Ontologies are content-addressed: `hashStoredOntology(schema)` is SHA-256 over canonical JSON. Field and label **descriptions** are part of the hash — two schemas with identical types but different descriptions are different ontology versions.

**SQLite schema** at `{dataDir}/registry/ontologies.db`:

- `ontologies` — append-only via `INSERT OR IGNORE`; primary key `ontology_hash`
- `database_ontology_links` — append-only link history; FK `ontology_hash → ontologies`

To change a database's ontology: compute the new hash, `registerOntology`, then `linkDatabase` (append). Prior links are kept for audit. Current link = latest `(linked_at_ms, link_id)` per database.

Helpers: `ontologyToStoredJsonSchema()` (from runtime `defineOntology`), `canonicalizeStoredOntology()`, `hashStoredOntology()`, `listOntologyLabelKinds()`.

Namespaces remain client-defined at merge time. There is no namespace policy registry in this phase.

See [roadmap/ontology-registry.md](./roadmap/ontology-registry.md) for phase-2 merge enforcement and runtime rehydration from stored JSON.

## Service API

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

```ts
createMemoriesDatabaseService({
  resolver: MemoriesDatabaseBackendResolver,
  maxCached?: number, // default 64, LRU eviction on open
});
```

Open connections are cached by database id. LRU eviction calls `handle.close()` best-effort. Explicit `close(id)` and `delete(id)` await checkpoint and handle close before removing cache entries and storage files.

## Local hosting

Turnkey wiring for SQLCipher files:

```ts
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";

const { service, placement, ontology, defaultStrategy } = createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  maxCached: 8,
});
```

This creates:

- Default strategy `{ kind: "sqlite", dataDir, sqlCipherKey }`
- Placement registry at `{dataDir}/registry/placements.db`
- Ontology registry at `{dataDir}/registry/ontologies.db`
- Resolver + service wired together

Per-principal overrides: `placement.setStrategy(id, strategy)`. Per-database ontology: `ontology.registerOntology(schema)` then `ontology.linkDatabase(id, hash)`.

Custom wiring:

```ts
import {
  createBackendResolver,
  createInMemoryPlacementStore,
  createMemoriesDatabaseService,
} from "@khoralabs/memories-service";
import { createLocalSqliteBackendFactory } from "@khoralabs/memories-service-storage-sqlite";

const placement = createInMemoryPlacementStore({ defaultStrategy });
const resolver = createBackendResolver({ placement, factory: createLocalSqliteBackendFactory() });
const service = createMemoriesDatabaseService({ resolver });
```

## HTTP surface

Database ids are passed in JSON bodies as `{ kind, ownerKey }` so path encoding stays stable across owner-key schemes.

### Lifecycle

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `GET` | `/databases` | List databases (`?kind=` optional) | `manage` |
| `POST` | `/databases/open` | Open database (cache connection) | `read` |
| `POST` | `/databases/exists` | Check existence | `read` |
| `POST` | `/databases/checkpoint` | WAL checkpoint | `write` |
| `POST` | `/databases/close` | Close cached connection | `manage` |
| `DELETE` | `/databases` | Delete database | `manage` |

### Persistence

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `POST` | `/databases/search` | Hybrid search | `read` |
| `POST` | `/databases/merge` | Merge memory node/edge | `write` |
| `POST` | `/databases/delete-memory` | Delete memory by namespace/key | `write` |
| `POST` | `/databases/provenance/head` | Provenance head root hex | `read` |
| `POST` | `/databases/capabilities` | Backend capabilities for database | `read` |

### SQLite read endpoints

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `POST` | `/databases/namespaces` | List namespaces | `read` |
| `POST` | `/databases/edge-preview` | Edge preview | `read` |
| `POST` | `/databases/source-map/text-preview` | Source map text preview | `read` |
| `POST` | `/databases/vector-dimensions` | Vector index dimensions | `read` |
| `POST` | `/databases/ensure-scope-chain` | Ensure scope chain paths | `write` |
| `POST` | `/databases/find-memory-id` | Resolve memory id by key | `read` |
| `POST` | `/databases/load-memory-namespace-key` | Load namespace/key by memory id | `read` |

### Ontology registry

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `POST` | `/ontologies/register` | Register ontology schema | `manage` |
| `POST` | `/ontologies/get` | Get ontology by hash | `read` |
| `POST` | `/ontologies/databases` | List databases by hash or label kinds | `read` |
| `POST` | `/databases/ontology/link` | Link database to ontology hash | `manage` |
| `POST` | `/databases/ontology/current` | Current ontology link | `read` |
| `POST` | `/databases/ontology/history` | Link history | `read` |

See [roadmap/http-memory-apis.md](./roadmap/http-memory-apis.md) for client usage.

## Authorization

The database service is pure: it does not decide who may access a database. The HTTP adapter authenticates and authorizes before calling the service.

```ts
type MemoriesDatabaseAccessStrategy = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: {
    actor: AuthenticatedActor;
    action: "read" | "write" | "manage";
    database?: MemoriesDatabaseId;
    namespace?: string;
  }): Promise<void>;
};
```

Shipped strategies (`MEMORIES_SERVICE_AUTH`):

| Scheme | Use |
|--------|-----|
| `none` | Embedded, local, or test deployments inside a trust boundary |
| `server-admin` | Bearer token (`MEMORIES_SERVICE_ADMIN_TOKEN`) grants full access |

One scheme per service instance. See [roadmap/decentralized-principal-auth.md](./roadmap/decentralized-principal-auth.md) and [roadmap/app-policy-auth.md](./roadmap/app-policy-auth.md) for planned strategies.

## Client

`MemoriesServiceClient` wraps the management HTTP API. Auth providers: `createNoAuthProvider()`, `createBearerTokenAuthProvider(token)`.

Runtime clients:

- `createRemoteMemoriesClientAsync()` — `MemoriesClientAsync` over HTTP (search, merge, delete-memory, provenance head)
- `createRemoteMemoriesReadClient()` — graph/index reads (namespaces, graph layout, edge preview, snippets, vector dimensions, scope chains)
- `MemoriesOntologyClient`, `ensureDatabaseOntologyLink()` — ontology register/link over HTTP

Hosts consume these from service clients, backend routes, or workflow adapters.

## Non-goals

- Namespace policy registry (namespaces stay client-defined at merge time)
- Host-specific team/session namespace builders
- Grant storage or delegation in the core service
- Assuming every database lives on the same filesystem
- Rehydrating `defineOntology()` from stored JSON (hosts keep TS ontology; registry is for discovery and audit)

## Roadmap

Planned work lives in [roadmap/](./roadmap/). Highlights:

- [App policy auth](./roadmap/app-policy-auth.md) — delegate authorization to the embedding application
- [Placement admin API](./roadmap/placement-admin-api.md) — HTTP routes for per-principal backend overrides
- [Ontology registry extensions](./roadmap/ontology-registry.md) — merge enforcement, runtime rehydration
- [Remote backends](./roadmap/remote-backends.md) — libSQL, remote nodes, principal-registered endpoints
- [Decentralized principal auth](./roadmap/decentralized-principal-auth.md) — DID request proofs, grants, portable credentials, revocation

Shipped: [HTTP memory APIs](./roadmap/http-memory-apis.md) (persistence, reads, remote client).
