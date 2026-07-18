# `@khoralabs/memories-service-storage-contract`

Shared conformance tests for Memories service storage:

- `MemoriesDatabaseBackend`
- `MemoriesDatabasePlacementStore`
- `MemoriesDatabaseOntologyStore`

## Usage

```ts
import {
  runMemoriesDatabaseBackendContractTests,
  runMemoriesDatabasePlacementStoreContractTests,
  runMemoriesDatabaseOntologyStoreContractTests,
} from "@khoralabs/memories-service-storage-contract";
import { createLocalSqliteBackend } from "@khoralabs/memories-service-storage-sqlite";

runMemoriesDatabaseBackendContractTests(
  "sqlite",
  () => createLocalSqliteBackend({ strategy: { kind: "sqlite", dataDir, sqlCipherKey } }),
  {
    canEnumerate: true,
    supportsCheckpoint: true,
    supportsSnapshot: false,
    requiresSqliteHandle: true,
    deleteClearsExistence: true,
  },
);
```
