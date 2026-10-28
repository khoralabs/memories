# @khoralabs/memories-spec

Smithy model for the memories **logical** persistence + public API contract. Describes operation sets, row shapes, and capability modules that `@khoralabs/memories-node` implements in TypeScript.

This package is **not** the HTTP wire model for `@khoralabs/memories-service` (lifecycle, ontology registry, and JSON field renames live in [`../service/spec.md`](../service/spec.md)). Spec tracks the in-process TS surfaces; keep them in sync when either side changes.

## Layout

| Path | Contents |
|------|----------|
| `model/persistence.smithy` | `MemoriesPersistenceService` and capability modules (`MemoriesPersistenceCore`, `MemoriesPersistenceVector`, …) |
| `model/shapes.smithy` | Shared shapes (rows, search/merge, provenance events, capabilities) |
| `model/public.smithy` | Public service surface (`MergeMemory`, `Search`, `DeleteMemory`, `ReplaceMemoryFeature`, suppress/unsuppress, rename/delete namespace) |
| `smithy-build.json` | Smithy build config |

## Capability modules

Use modules to see what a minimal backend can omit; use the aggregate `MemoriesPersistenceService` for a full adapter contract:

| Smithy service | Approximate TypeScript |
|----------------|------------------------|
| `MemoriesPersistenceCore` | Lexical mutation + catalog + suppress flags + lexical search + provenance + `ClearSourceMapFeatures` / graph facet outbox |
| `MemoriesPersistenceVector` | Vector features + vector search |
| `MemoriesPersistenceNeighbors` | `MemoriesNeighborIndex` |
| `MemoriesPersistenceLabelProps` | `syncLabelPropsSearchFeatures` |
| `MemoriesPersistenceReads` | Prefetch / export reads + optional tipReplay ops (`GetMemoryGraph/Vector/ProvenanceEventJsonAtRootHex`) |

**`tipReplayAtRootHex`:** when true, Reads tip graph/vector/provenance-json ops are available (TS names end in `Async`). Reference SQL adapters (sqlite, libsql, turso-serverless) all set this and implement the readers.

**Encoding note:** Spec uses Smithy tagged unions for request discriminants; TypeScript uses `kind` / `memoryKind` fields. Provenance `event_json` always includes an explicit `kind` (hashed).

Operational semantics: [`../node/src/persistence/IMPLEMENTORS.md`](../node/src/persistence/IMPLEMENTORS.md).

## Validation

Requires the [Smithy CLI](https://smithy.io/2.0/guides/smithy-cli/index.html):

```bash
cd packages/spec
smithy validate model
smithy build
```

Or: `bun run validate` from this package (runs both commands).
