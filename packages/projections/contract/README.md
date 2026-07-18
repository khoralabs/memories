# `@khoralabs/memories-projections-contract`

Shared conformance tests for `GraphProjectionSource` strategy adapters.

## Usage

```ts
import { runMemoriesProjectionsContractTests } from "@khoralabs/memories-projections-contract";
import { createLibsqlDatabase, createMemoriesLibsqlPersistence } from "@khoralabs/memories-libsql";
import { createLibsqlGraphProjectionSource } from "@khoralabs/memories-projections-libsql";

runMemoriesProjectionsContractTests("libsql", async () => {
  const db = createLibsqlDatabase({ url: "file:./tmp.db" });
  const persistence = await createMemoriesLibsqlPersistence({ db });
  return {
    source: createLibsqlGraphProjectionSource(db.client),
    persistence,
  };
});
```

The factory must return a `GraphProjectionSource` plus a `MemoriesPersistenceAsync` used for seeding (`mergeMemoryAsync`) and graph reads.
