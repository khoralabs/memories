# @khoralabs/memories-service-storage-sqlite

Local SQLCipher backend, SQLite placement registry, and ontology registry for `@khoralabs/memories-service`.

Turnkey hosting:

```ts
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";

const { service, placement, ontology, defaultStrategy } = createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY ?? TEST_SQLCIPHER_KEY,
  maxCached: 8,
});
```

Registries:

- `{dataDir}/registry/placements.db` — per-principal backend strategies
- `{dataDir}/registry/ontologies.db` — content-addressed ontology JSON Schemas and append-only database links

The SQLite registries are one control-plane implementation. Node storage can be
heterogeneous by passing a composite backend factory:

```ts
import { createCompositeBackendFactory } from "@khoralabs/memories-service";
import { createTursoServerlessBackendFactory } from "@khoralabs/memories-service-storage-turso-serverless";

const mixedFactory = createCompositeBackendFactory({
  sqlite: createLocalSqliteBackendFactory(),
  "turso-serverless": createTursoServerlessBackendFactory(),
});

const stack = createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY!,
  backendFactory: mixedFactory,
});
```

The same node strategies could be selected by a different placement registry
implementation, such as a future Turso-backed registry/control plane.

See [../spec.md](../spec.md) for the full design.
