# @khoralabs/memories-service-storage-sqlite

Local SQLCipher file backend, SQLite placement registry, and SQLite ontology registry for `@khoralabs/memories-service`.

## Turnkey setup

```ts
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";

const { service, placement, ontology, defaultStrategy } = createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  maxCached: 8,
});
```

This wires:

- Default strategy `{ kind: "sqlite", dataDir, sqlCipherKey }`
- Placement registry at `{dataDir}/registry/placements.db`
- Ontology registry at `{dataDir}/registry/ontologies.db`
- `createBackendResolver` + `createMemoriesDatabaseService` from `@khoralabs/memories-service`
- Storage contracts from `@khoralabs/memories-service-storage-core`

`registryPath` and `ontologyRegistryPath` can be overridden independently:

```ts
createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  registryPath: "./config/placements.db",
  ontologyRegistryPath: "./config/ontologies.db",
});
```

## Heterogeneous node backends

Pass a custom `backendFactory` to mix SQLite and Turso nodes under the same placement registry:

```ts
import { createCompositeBackendFactory } from "@khoralabs/memories-service";
import { createTursoServerlessBackendFactory } from "@khoralabs/memories-service-storage-turso-serverless";

const { service, placement } = createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  backendFactory: createCompositeBackendFactory({
    sqlite: createLocalSqliteBackendFactory(),
    "turso-serverless": createTursoServerlessBackendFactory(),
  }),
});

// Route one principal to Turso:
await placement.setStrategy(
  { kind: "account", ownerKey: "alice" },
  {
    kind: "turso-serverless",
    url: "libsql://alice-db.my-org.turso.io",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
);
```

## Standalone factories

Use individual factories when you manage resolver and service wiring yourself:

```ts
import {
  createLocalSqliteBackendFactory,
  createSqlitePlacementStore,
  createSqliteOntologyStore,
} from "@khoralabs/memories-service-storage-sqlite";
import { createBackendResolver, createMemoriesDatabaseService } from "@khoralabs/memories-service";

const placement = createSqlitePlacementStore({
  registryPath: "./data/registry/placements.db",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  defaultStrategy: { kind: "sqlite", dataDir: "./data/memories", sqlCipherKey: "..." },
});

const ontology = createSqliteOntologyStore({
  registryPath: "./data/registry/ontologies.db",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
});

const resolver = createBackendResolver({
  placement,
  factory: createLocalSqliteBackendFactory(),
});

const service = createMemoriesDatabaseService({ resolver, maxCached: 32 });
```

For direct backend construction, use the shared options-object shape:

```ts
import { createLocalSqliteBackend } from "@khoralabs/memories-service-storage-sqlite";

const backend = createLocalSqliteBackend({
  strategy: { kind: "sqlite", dataDir: "./data/memories", sqlCipherKey: "..." },
});
```

## File layout

```
{dataDir}/
  v1/{base64url([kind, ownerKey])}/database.db   ← principal database (+ -wal, -shm)
  registry/
    placements.db    ← placement strategy overrides
    ontologies.db    ← content-addressed ontology schemas + links
```

`kind` is logical identity only. Use `resolveLocalSqliteDatabasePath(dataDir, id)` to compute the path for any `MemoriesDatabaseId`.

## Registries

**Placement registry** (`placements.db`):
- `placement_defaults` — singleton default strategy row.
- `placement_overrides` — per-principal strategy overrides, primary key `(kind, owner_key)`.

**Ontology registry** (`ontologies.db`):
- `ontologies` — append-only via `INSERT OR IGNORE`; primary key `ontology_hash` (SHA-256 hex).
- `database_ontology_links` — append-only link history per database; current link is the latest `(linked_at_ms, link_id)` row.

Both registries are SQLCipher-encrypted with the same `sqlCipherKey` as the node databases.

## Behavior Notes

- `list()` enumerates local database files under `{dataDir}/v1`.
- `checkpoint(id)` runs `PRAGMA wal_checkpoint(TRUNCATE)`.
- `snapshot(id)` is part of the storage-core contract but currently throws `UnsupportedStorageFeatureError`.

## Related packages

- `@khoralabs/memories-service-storage-core` — storage contracts, placement/ontology interfaces, strategy helpers
- `@khoralabs/memories-service` — resolver, service orchestration, connection cache
- `@khoralabs/memories-service-storage-turso-serverless` — Turso Cloud node backend
- `@khoralabs/memories-sqlite` — underlying SQLite persistence implementation
