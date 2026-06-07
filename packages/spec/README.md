# @khoralabs/memories-spec

Smithy wire model for the memories persistence contract. Describes operation sets, row shapes, and capability modules that `@khoralabs/memories-core` and `@khoralabs/memories-sqlite` implement in TypeScript.

## Layout

| Path | Contents |
|------|----------|
| `model/persistence.smithy` | `MemoriesPersistenceService` and capability modules (`MemoriesPersistenceCore`, `MemoriesPersistenceVector`, …) |
| `model/shapes.smithy` | Shared shapes |
| `model/public.smithy` | Public service surface |
| `smithy-build.json` | Smithy build config |

## Capability modules

Use modules to see what a minimal backend can omit; use the aggregate `MemoriesPersistenceService` for a full adapter contract:

| Smithy service | Approximate TypeScript |
|----------------|----------------------|
| `MemoriesPersistenceCore` | Lexical mutation + catalog + lexical search |
| `MemoriesPersistenceVector` | Vector features + vector search |
| `MemoriesPersistenceNeighbors` | `MemoriesNeighborIndex` |
| `MemoriesPersistenceLabelProps` | `syncLabelPropsSearchFeatures` |
| `MemoriesPersistenceReads` | Prefetch / export reads |

See [`packages/persistence/sqlite/IMPLEMENTORS.md`](../persistence/sqlite/IMPLEMENTORS.md) for operational semantics mapped to these operations.

## Validation

Requires the [Smithy CLI](https://smithy.io/2.0/guides/smithy-cli/index.html):

```bash
cd packages/spec
smithy validate model
smithy build
```

Or: `bun run validate` from this package (runs both commands).
