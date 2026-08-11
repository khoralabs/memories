# Memories Service

Reusable packages for managing many Memories databases per principal: route requests to the right database, cache open connections, and keep authorization outside the core service.

## Packages

`@khoralabs/memories-service` is a single package with subpath exports:

| Export | Role |
|--------|------|
| `.` | Backend-agnostic lifecycle: ids, placement interfaces, resolver, LRU cache |
| `./http` | HTTP adapter (lifecycle, persistence, reads, ontology, attribution) |
| `./auth` | Auth strategies (`none`, `server-admin`, `app-policy`, `did-principal`) |
| `./client` | Management HTTP client, remote `MemoriesClientAsync`, read client, ontology helpers |
| `./storage/sqlite` | Local SQLCipher backend, SQLite placement + ontology registries, turnkey stack (**Bun**) |
| `./storage/libsql` | Local libSQL backend (Node-safe) |
| `./storage/turso-serverless` | Turso serverless backend (Node-safe) |
| `./testing` | Conformance runners |

Attestation formats used by HTTP attribution live in `@khoralabs/memories-node/attestation`.

## Database identity

```ts
type DatabaseKind = "organization" | "account" | string;

type MemoriesDatabaseId = {
  kind: DatabaseKind;
  ownerKey: string;
};
```

`ownerKey` is opaque. Hosts can pass DIDs, tenant ids, UUIDs, or external handles. The service validates ids but does not interpret owner-key semantics.

Optional **catalog attributes** (`name`, `description`) are stored in the service control-plane `database_catalog` registry keyed by `{ kind, ownerKey }`. They are not part of `MemoriesDatabaseId`. Missing catalog rows resolve to empty strings when listing.

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
import type { MemoriesBackendCapabilities } from "@khoralabs/memories-node/persistence";

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

Each strategy advertises what its opened database supports: hybrid search arms, graph index reads, multi-namespace search, unscoped search, as-of search, and so on. The shape matches `MemoriesPersistence.capabilities` from `@khoralabs/memories-node/persistence`. Omitted keys resolve via `resolveStrategyCapabilities(strategy)` — sqlite defaults to the full local SQLite feature set; other kinds use their strategy defaults unless overridden.

Hosts can read placement strategies before opening a database to decide whether agent workloads (vector search, graph expansion, integrator merges) are viable on that backend.

Mixed node strategies are enabled by a composite backend factory:

```ts
const factory = createCompositeBackendFactory({
  sqlite: createLocalSqliteBackendFactory(),
  libsql: createLocalLibsqlBackendFactory(),
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

Phase-2 merge enforcement and runtime rehydration from stored JSON remain open; see [roadmap/](./roadmap/).

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

Turnkey wiring for local SQLite (SQLCipher when `sqlCipherKey` is set):

```ts
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service/storage/sqlite";

const { service, placement, ontology, catalog, defaultStrategy } = createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  ...(process.env.MEMORIES_SQLCIPHER_KEY
    ? { sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY }
    : {}),
  maxCached: 8,
});
```

This creates:

- Default strategy `{ kind: "sqlite", dataDir, sqlCipherKey? }` (encrypted only when a key is provided)
- Placement registry at `{dataDir}/registry/placements.db`
- Ontology registry at `{dataDir}/registry/ontologies.db`
- Database catalog at `{dataDir}/registry/databases.db`
- Composite backend factory (`sqlite`, `libsql`, `turso-serverless`) + resolver + service

Per-principal overrides: `placement.setStrategy(id, strategy)`. Per-database ontology: `ontology.registerOntology(schema)` then `ontology.linkDatabase(id, hash)`. Catalog: `catalog.upsert(id, { name, description })`.

Custom wiring:

```ts
import {
  createBackendResolver,
  createInMemoryPlacementStore,
  createMemoriesDatabaseService,
} from "@khoralabs/memories-service";
import { createLocalSqliteBackendFactory } from "@khoralabs/memories-service/storage/sqlite";

const placement = createInMemoryPlacementStore({ defaultStrategy });
const resolver = createBackendResolver({ placement, factory: createLocalSqliteBackendFactory() });
const service = createMemoriesDatabaseService({ resolver });
```

## HTTP surface

Database ids are passed in JSON bodies as `{ kind, ownerKey }` so path encoding stays stable across owner-key schemes.

### Lifecycle

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `GET` | `/databases` | List databases with catalog `name`/`description` (`?kind=` optional) | `manage` |
| `POST` | `/databases/open` | Open database (cache connection); optional `name`/`description` upsert catalog | `read` |
| `POST` | `/databases/exists` | Check existence | `read` |
| `POST` | `/databases/checkpoint` | WAL checkpoint | `write` |
| `POST` | `/databases/close` | Close cached connection | `manage` |
| `DELETE` | `/databases` | Delete database (and catalog row) | `manage` |
| `POST` | `/databases/metadata/get` | Get catalog name/description | `read` |
| `POST` | `/databases/metadata/upsert` | Upsert catalog name/description | `manage` |

### Persistence

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `POST` | `/databases/search` | Hybrid search | `read` |
| `POST` | `/databases/search-namespaces` | Rank namespaces (nodes / lexical; vector when client supplies 512–3072 float32 `vector`) | `read` |
| `POST` | `/databases/merge` | Merge memory node/edge | `write` |
| `POST` | `/databases/delete-memory` | Delete memory by namespace/key | `write` |
| `POST` | `/databases/provenance/head` | Provenance head root hex | `read` |
| `POST` | `/databases/capabilities` | Backend capabilities for database | `read` |

Client-supplied embeddings on `search`, `search-namespaces` (`vector`), and `merge` (`content[].vector`, `searchMetaVector`) must be **512–3072** float32 values.

Suppression: discovery endpoints exclude suppressed memories/namespaces by default. Pass `includeSuppressed: true` (on the body, or `params.options.includeSuppressed` for search) to include them. Responses that return namespaces or memories always include exact-path `suppressed: boolean` (`namespace_metadata.suppressed` / `memories.suppressed`, not ancestor-inferred). Use `POST /databases/effective-suppression` for ancestor-aware status (`effectivelySuppressed`, closest `suppressedBy` namespace).

### SQLite read endpoints

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `POST` | `/databases/namespaces` | Primary catalog list (`alias`, `description`, optional `suppressed`); path-only helpers are client-side projections | `read` |
| `POST` | `/databases/namespaces/under-prefix` | Catalog list under a path-boundary prefix (`= prefix` or nested under `prefix/`) | `read` |
| `POST` | `/databases/namespaces/exists-under-prefix` | Whether any catalog path exists under a path-boundary prefix | `read` |
| `POST` | `/databases/namespaces/get` | Get one namespace metadata row | `read` |
| `POST` | `/databases/namespaces/upsert` | Upsert namespace alias/description (soft rename) | `write` |
| `POST` | `/databases/namespaces/delete` | Delete namespace (default recursive subtree) | `write` |
| `POST` | `/databases/namespaces/rename` | Literal path rename (bulk id rewrite) | `write` |
| `POST` | `/databases/edge-preview` | Edge preview | `read` |
| `POST` | `/databases/memory-preview` | Memory labels + source-map text + freeform `properties` | `read` |
| `POST` | `/databases/source-map/text-preview` | Source map text preview | `read` |
| `POST` | `/databases/vector-dimensions` | Vector index dimensions | `read` |
| `POST` | `/databases/projections/projection-input` | Compressed projection input rows for external layout workers | `read` |
| `POST` | `/databases/projections/umap-input` | Deprecated alias of `projection-input` | `read` |
| `POST` | `/databases/graph-layout` | Ready graph layout JSON (projection-input → layout on server) | `read` |
| `POST` | `/databases/ensure-scope-chain` | Ensure scope chain paths | `write` |
| `POST` | `/databases/find-memory-id` | Resolve memory id by key | `read` |
| `POST` | `/databases/effective-suppression` | Ancestor-aware suppression status (`suppressedBy` closest covering namespace) | `read` |
| `POST` | `/databases/load-memory-namespace-key` | Load namespace/key by memory id | `read` |

### Ontology registry

| Method | Path | Action | Auth action |
|--------|------|--------|-------------|
| `POST` | `/ontologies/register` | Register ontology schema | `manage` |
| `POST` | `/ontologies/get` | Get ontology by hash | `read` |
| `POST` | `/ontologies/databases` | List databases by hash or label kinds | `read` |
| `POST` | `/databases/ontology/link` | Link database to ontology hash | `manage` |
| `POST` | `/databases/hash` | Current ontology hash for database | `read` |
| `POST` | `/databases/ontology/current` | Current ontology link | `read` |
| `POST` | `/databases/ontology/history` | Link history | `read` |

Client usage: `@khoralabs/memories-service/client` (see [Client](#client) below).

## Authorization

The database service is pure: it does not decide who may access a database. The HTTP adapter authenticates and authorizes before calling the service. Authz is **not** part of the Smithy persistence model; scopes are derived from existing operation inputs.

```ts
type AuthorizeScope =
  | { kind: "database" }
  | { kind: "namespace"; namespace: string; mode: "exact" | "subtree" }
  | { kind: "namespaces"; namespaces: string[]; mode: "exact" | "subtree" }
  | { kind: "namespaceRename"; from: string; to: string; mode: "exact" | "subtree" }
  | { kind: "unscoped" };

type MemoriesDatabaseAccessStrategy = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: {
    actor: AuthenticatedActor;
    action: "read" | "write" | "manage";
    database?: MemoriesDatabaseId;
    scope: AuthorizeScope;
    /** @deprecated Mirrored when scope.kind === "namespace" */
    namespace?: string;
  }): Promise<void>;
};
```

Shipped strategies (`MEMORIES_SERVICE_AUTH`):

| Scheme | Use |
|--------|-----|
| `none` | Embedded, local, or test deployments inside a trust boundary |
| `server-admin` | Bearer token (`MEMORIES_SERVICE_ADMIN_TOKEN`) grants full access |
| `app-policy` | Host-wired `createAppPolicyAuthStrategy({ authenticate, authorize })`; env alone cannot construct it |
| `did-principal` | Host-wired `createDidPrincipalAuthStrategy({ verify, resolveGrants? })`; proof verify is injected (no khora dependency); env alone cannot construct it |

One scheme per service instance.

### `did-principal`

Proof verification is **host-injected**. Memories does not depend on khora/relay and does not parse `X-Agent-*` headers.

```ts
type PrincipalProofVerifier = {
  verify(input: {
    method: string;
    request: Request;
  }): Promise<{ did: string; keyId?: string }>;
};

createDidPrincipalAuthStrategy({
  verify: PrincipalProofVerifier;
  resolveGrants?: (input: {
    actor: AuthenticatedActor;
    database: MemoriesDatabaseId;
  }) => Promise<HostGrant[]> | HostGrant[];
}): MemoriesDatabaseAccessStrategy
```

- **authenticate:** `verify` → `{ scheme: "did-principal", subject: did }` (401 on failure).
- **authorize:** requires `database`; allow if `actor.subject === database.ownerKey` (full `manage` ⊇ write ⊇ read); else match `resolveGrants` via `authorizeScopeAgainstGrants`; else 403.

Hosts typically adapt `@khoralabs/khora-auth` `verifySignedAgentRequest` into `PrincipalProofVerifier`. For HTTP attribution, use `principalForActor: (actor) => actor.subject`.

HTTP always passes a typed `scope` into `authorize`:

| Route pattern | Typical `scope` |
|---------------|-----------------|
| Open / close / delete DB, list namespaces, capabilities, ontology link | `{ kind: "database" }` |
| Merge, delete-memory, namespace get/upsert, scoped search | `{ kind: "namespace", … }` |
| Search with `additionalNamespaces` | `{ kind: "namespaces", … }` |
| Search with `searchEntireDatabase` | `{ kind: "unscoped" }` |
| Namespace delete | `{ kind: "namespace", mode: "subtree" \| "exact" }` from `recursive` (default subtree) |
| Namespace rename | `{ kind: "namespaceRename", from, to, mode }` |

Host matching rules and reference helpers (`authorizeScopeAgainstGrants`, etc.): [src/auth/HOST_POLICY.md](./src/auth/HOST_POLICY.md).

## Client

`MemoriesServiceClient` wraps the management HTTP API. Auth providers: `createNoAuthProvider()`, `createBearerTokenAuthProvider(token)`.

- `listDatabases()` → `{ id, name, description }[]`
- `getDatabaseMetadata` / `upsertDatabaseMetadata`
- `openDatabase(id, { name?, description? })` — optional catalog fields on open

Runtime clients:

- `createRemoteMemoriesClientAsync()` — `MemoriesClientAsync` over HTTP (search, merge, delete-memory, provenance head)
- `createRemoteMemoriesReadClient()` — graph/index reads (namespaces with metadata, graph layout, edge preview, snippets, vector dimensions, scope chains)
- `MemoriesOntologyClient`, `ensureDatabaseOntologyLink()` — ontology register/link over HTTP

Hosts consume these from service clients, backend routes, or workflow adapters.

## Telemetry

Optional structured telemetry via `@khoralabs/memories-node/telemetry` and `@khoralabs/memories-otel`:

```ts
createMemoriesDatabaseService({ resolver, telemetry: createMemoriesOtelTelemetry({ tracer }) });
```

Emits database lifecycle (`open` / `close` / `delete` / `evict`) and threads a database-bound sink into HTTP merge/search/delete so node ops include `memories.database.*` attributes. Libraries do not start an OTel SDK. Networked ingest (`POST /telemetry/events`) is planned — see [roadmap](./roadmap/README.md#telemetry-event-ingest-phase-2) and [otel README](../otel/README.md).

Optional HTTP/stack options for namespace quotas/limits:

- **`maxNamespaces`**: cap on distinct paths (memories ∪ metadata). `undefined` = unlimited. Enforced when merge, namespace metadata upsert, or literal rename introduces a **net-new** path (`NamespaceConstraintError` → HTTP 400).
- **`maxNamespaceDepth`** / **`maxNamespacePathLength`**: host write policy for path segment depth and character length (defaults **6** / **512**; absolute ceilings **32** / **2048**). Segment charset remains `[a-z0-9_-]+`. Advertised on `POST /databases/capabilities` as `namespaceLimits: { maxDepth, maxLength }`.

**Namespace alias vs literal rename:** upsert `alias` is soft rename (UI label; path key unchanged; DB column `display_name`). `POST /databases/namespaces/rename` rematerializes memory/node/edge ids under a new path (rare/destructive). Upsert still accepts deprecated `displayName` as synonym for `alias`.

## Non-goals

- Namespace policy registry (alias metadata on namespaces is not ACL/policy; namespaces stay client-defined at merge time; `maxNamespaces` is a host quota, not ACL)
- Host-specific team/session namespace builders
- Grant storage or delegation in the core service
- Assuming every database lives on the same filesystem
- Rehydrating `defineOntology()` from stored JSON (hosts keep TS ontology; registry is for discovery and audit)
- Embedding an OpenTelemetry Collector inside the service

## Roadmap

Status and planned work: [roadmap/](./roadmap/).
