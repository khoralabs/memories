# @khoralabs/memories-service-storage-turso-serverless

Turso Cloud **node backend** for the Memories database service. It maps a placement
strategy `{ kind: "turso-serverless", url, authToken }` to a remote Turso-backed
memory node.

This package is not a placement or ontology registry. The registry/control plane
is supplied by the host through the `@khoralabs/memories-service` placement and
ontology interfaces. That control plane may be backed by SQLite today, Turso in
the future, or another storage implementation entirely.

## Strategy

```ts
type TursoServerlessBackendStrategy = {
  kind: "turso-serverless";
  /** Supports `{ownerKey}` and `{kind}` placeholders for per-principal Turso databases. */
  url: string;
  authToken?: string;
  remoteEncryptionKey?: string;
};
```

Example URL template (one Turso database per principal):

```ts
{
  kind: "turso-serverless",
  url: "libsql://memories-{ownerKey}.my-org.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN,
}
```

Or store a full URL per principal via placement overrides:

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

## Mixed Node Wiring

The example below uses SQLite-backed registries for the control plane, but the
same backend factory works with any placement registry implementation.

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

Now the same placement registry can mix node strategies:

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

## Listing Semantics

`list()` on the Turso backend returns `[]` because this package does not call
Turso Cloud provisioning/list APIs. Placed Turso nodes still appear through
`resolver.list()` because placement overrides are part of the registry/control
plane.

## Delete semantics

`delete(id)` clears all Memories tables in the resolved remote Turso database.
It does not remove placement records or drop the Turso Cloud database itself.

## Related packages

- `@khoralabs/memories-turso-serverless` — persistence implementation
- `@khoralabs/memories-service` — resolver, placement, connection cache
- `@khoralabs/memories-service-storage-sqlite` — local file backend plus current SQLite placement/ontology registries
