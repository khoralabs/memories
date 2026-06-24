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

See [../spec.md](../spec.md) for the full design.
