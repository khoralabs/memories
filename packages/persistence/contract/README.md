# `@khoralabs/memories-persistence-contract`

Shared conformance tests for `MemoriesPersistenceAsync` backends.

## Usage

```ts
import { runMemoriesPersistenceContractTests } from "@khoralabs/memories-persistence-contract";
import { createMemoriesPersistenceAsync, openTestMemoriesDatabase } from "@khoralabs/memories-sqlite";

runMemoriesPersistenceContractTests("sqlite", () =>
  createMemoriesPersistenceAsync(openTestMemoriesDatabase()),
);
```

Suites that need optional capabilities (`lexicalSearch`, `graphIndex`, `vectorSearch`, `unscopedSearch`, `asOfTimestampMsSearch`) are skipped when the backend reports them off.
