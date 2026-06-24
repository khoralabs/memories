# Memories Service

Reusable packages for managing many Memories databases per principal. Extracted from Exedra's hosting pattern: route requests to the right database, cache open connections, and keep authorization outside the core service.

## Packages

| Package | Role |
|---------|------|
| `@khoralabs/memories-service` | Backend-agnostic database lifecycle: ids, validation, placement interfaces, resolver, LRU connection cache |
| `@khoralabs/memories-service-storage-sqlite` | Local SQLCipher file backend, SQLite placement registry, and ontology registry |
| `@khoralabs/memories-service-http` | HTTP management adapter |
| `@khoralabs/memories-service-auth` | HTTP auth strategies (`none`, `server-admin`) |
| `@khoralabs/memories-service-client` | Typed management HTTP client |

The core service depends only on `@khoralabs/memories-core` and `lru-cache`. SQLite and HTTP auth live in sibling packages.

## Database identity

```ts
type DatabaseKind = "organization" | "account" | string;

type MemoriesDatabaseId = {
  kind: DatabaseKind;
  ownerKey: string;
};
```

`ownerKey` is opaque. Exedra can pass a DID; other hosts can pass tenant ids, UUIDs, or external handles. The service validates ids but does not interpret owner-key semantics.

### File layout

The default sqlite backend encodes owner keys reversibly and writes versioned paths:

```text
{dataDir}/v1/{kind}/{base64url(ownerKey)}/{base64url(ownerKey)}.db
```

Helpers live in `@khoralabs/memories-service`: `createReversibleOwnerKeyEncoder()`, `resolveEncodedDatabasePath()`, `OWNER_KEY_ENCODING_VERSION`.

## Backend and placement

The service routes each database id to a backend through a resolver and placement store.

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

Resolver behavior:

1. Read per-principal override from `placement.getStrategy(id)`
2. Fall back to `placement.getDefaultStrategy()`
3. Return a backend from `factory.create(strategy)`, cached by canonical strategy JSON

Only the `sqlite` strategy is implemented today. Other shapes use the open `{ kind: string; ... }` branch when a backend package adds them.

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

See [roadmap/ontology-registry.md](./roadmap/ontology-registry.md) for deferred HTTP admin and runtime rehydration from stored JSON.

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

Open connections are cached by database id. Eviction calls `handle.close()` on the backend. `close(id)` drops the cache entry; `delete(id)` closes the cache entry then deletes storage.

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

Management routes only. Database ids are passed in JSON bodies as `{ kind, ownerKey }` so path encoding stays stable across owner-key schemes.

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `GET` | `/databases` | List databases (`?kind=` optional) | `manage` |
| `POST` | `/databases/open` | Open database (cache connection) | `read` |
| `POST` | `/databases/exists` | Check existence | `read` |
| `POST` | `/databases/checkpoint` | WAL checkpoint | `write` |
| `POST` | `/databases/close` | Close cached connection | `manage` |
| `DELETE` | `/databases` | Delete database | `manage` |

Memory search, merge, and graph APIs are not exposed over HTTP yet.

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

There is no remote `MemoriesPersistenceAsync` client yet.

## Non-goals

- Namespace policy registry (namespaces stay client-defined at merge time)
- Exedra-specific team/session namespace builders
- Grant storage or delegation in the core service
- Assuming every database lives on the same filesystem
- Rehydrating `defineOntology()` from stored JSON (hosts keep TS ontology; registry is for discovery and audit)

## Roadmap

Planned work lives in [roadmap/](./roadmap/). Highlights:

- [Decentralized principal auth](./roadmap/decentralized-principal-auth.md) — DID request proofs, grants, portable credentials, revocation
- [App policy auth](./roadmap/app-policy-auth.md) — delegate authorization to the embedding application
- [Remote backends](./roadmap/remote-backends.md) — libSQL, remote nodes, principal-registered endpoints
- [HTTP memory APIs](./roadmap/http-memory-apis.md) — search, merge, graph over HTTP
- [Exedra integration](./roadmap/exedra-integration.md) — migrate Exedra onto these packages
- [Placement admin API](./roadmap/placement-admin-api.md) — HTTP routes for per-principal backend overrides
- [Ontology registry extensions](./roadmap/ontology-registry.md) — HTTP admin, runtime rehydration, merge enforcement
