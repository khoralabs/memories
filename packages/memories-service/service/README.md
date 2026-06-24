# @khoralabs/memories-service

Backend-agnostic database lifecycle service for managing many Memories databases.

The core package defines database ids, backend/placement/ontology interfaces, resolver, and an LRU connection cache. It does not depend on SQLite.

For local SQLCipher hosting, use `@khoralabs/memories-service-storage-sqlite`:

```ts
import { TEST_SQLCIPHER_KEY } from "@khoralabs/sqlite-crypto";
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";

const { service } = createLocalSqliteServiceStack({
  dataDir: "./data/memories",
  sqlCipherKey: process.env.MEMORIES_SQLCIPHER_KEY ?? TEST_SQLCIPHER_KEY,
});

const persistence = await service.open({ kind: "account", ownerKey: "owner-a" });
```

Custom wiring with an explicit resolver:

```ts
import {
  createBackendResolver,
  createMemoriesDatabaseService,
  createInMemoryPlacementStore,
} from "@khoralabs/memories-service";
import { createLocalSqliteBackendFactory } from "@khoralabs/memories-service-storage-sqlite";

const defaultStrategy = {
  kind: "sqlite" as const,
  dataDir: "./data/memories",
  sqlCipherKey: TEST_SQLCIPHER_KEY,
};
const placement = createInMemoryPlacementStore({ defaultStrategy });
const resolver = createBackendResolver({
  placement,
  factory: createLocalSqliteBackendFactory(),
});
const service = createMemoriesDatabaseService({ resolver });
```

See [../spec.md](../spec.md) for the full design.
