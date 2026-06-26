# @khoralabs/memories-service-storage-turso-serverless

Turso Cloud **node backend** for the Memories database service. Maps a placement strategy `{ kind: "turso-serverless", url, authToken }` to a remote Turso-backed memory node.

This package is a **node data plane only**. It does not include a placement or ontology registry. The control plane is supplied by the host — typically `createSqlitePlacementStore` from `@khoralabs/memories-service-storage-sqlite`, though any `MemoriesDatabasePlacementStore` implementation works.

## Strategy

```ts
type TursoServerlessBackendStrategy = {
  kind: "turso-serverless";
  /** Turso database URL. Supports `{ownerKey}` and `{kind}` placeholders. */
  url: string;
  authToken?: string;
  remoteEncryptionKey?: string;
  capabilities?: Partial<MemoriesBackendCapabilities>;
};
```

## URL templates

The `url` field supports two placeholders for per-principal database routing. Both are `encodeURIComponent`-escaped before substitution:

| Placeholder | Value |
|-------------|-------|
| `{ownerKey}` | `id.ownerKey` |
| `{kind}` | `id.kind` |

```ts
// One Turso database per principal, named by ownerKey:
{
  kind: "turso-serverless",
  url: "libsql://memories-{ownerKey}.my-org.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN,
}
```

For principals whose ownerKey contains special characters, use a full URL per-principal via placement overrides instead.

## Per-principal overrides

Store a fully resolved URL for each principal via `placement.setStrategy`:

```ts
await placement.setStrategy(
  { kind: "account", ownerKey: "alice" },
  {
    kind: "turso-serverless",
    url: "libsql://alice-db.my-org.turso.io",
    authToken: process.env.TURSO_ALICE_TOKEN,
  },
);
```

## Wiring with SQLite registries

```ts
import { createBackendResolver, createCompositeBackendFactory } from "@khoralabs/memories-service";
import {
  createLocalSqliteBackendFactory,
  createSqliteOntologyStore,
  createSqlitePlacementStore,
} from "@khoralabs/memories-service-storage-sqlite";
import { createTursoServerlessBackendFactory } from "@khoralabs/memories-service-storage-turso-serverless";

const placement = createSqlitePlacementStore({
  registryPath: "./data/registry/placements.db",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  defaultStrategy: {
    kind: "sqlite",
    dataDir: "./data/memories",
    sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  },
});

const ontology = createSqliteOntologyStore({
  registryPath: "./data/registry/ontologies.db",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
});

const factory = createCompositeBackendFactory({
  sqlite: createLocalSqliteBackendFactory(),
  "turso-serverless": createTursoServerlessBackendFactory(),
});

const resolver = createBackendResolver({ placement, factory });
```

## Credentials helpers

`resolveTursoDatabaseUrl` and `resolveTursoCredentials` are exported for hosts that need to construct credentials independently:

```ts
import {
  resolveTursoDatabaseUrl,
  resolveTursoCredentials,
} from "@khoralabs/memories-service-storage-turso-serverless";

const url = resolveTursoDatabaseUrl(strategy, id);
// → "libsql://memories-alice.my-org.turso.io" (placeholders substituted)

const credentials = resolveTursoCredentials(strategy, id);
// → { url, authToken, remoteEncryptionKey }
```

## Behavior notes

**`list()`** — returns `[]`. This backend does not call Turso Cloud provisioning or list APIs. Principals placed via explicit placement overrides still appear in `resolver.list()` because the resolver merges override ids from the placement store.

**`exists(id)`** — opens a short-lived connection, probes for the schema version table or a row in `memories`, then closes. Returns `false` on any connectivity or schema error rather than throwing.

**`delete(id)`** — opens a connection and `DELETE`s all Memories tables in FK-safe order. Does **not** remove placement records or drop the Turso Cloud database itself. To reprovision or decommission a Turso database, use the Turso Cloud API separately.

**`checkpoint(id)`** — no-op. WAL checkpointing is not applicable to remote Turso databases.

**`handle.sqlite`** — not set. SQLite-specific graph read helpers (`loadDatabaseGraphLayout`, etc.) are not available for Turso-backed databases.

## Related packages

- `@khoralabs/memories-turso-serverless` — underlying Turso persistence implementation
- `@khoralabs/memories-service` — resolver, placement interface, connection cache
- `@khoralabs/memories-service-storage-sqlite` — local file backend plus SQLite placement/ontology registries
