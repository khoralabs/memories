# @khoralabs/memories-persistence-core

Shared persistence contracts and deterministic storage primitives for Memories.

This package owns the pieces persistence implementations must agree on:

- `MemoriesPersistence` / `MemoriesPersistenceAsync` contracts and capabilities.
- Zod row schemas, document validators, and row TypeScript types.
- Stable ID and namespace helpers used for primary keys and subtree indexes.
- Stored ontology label payload/search helper types.
- Provenance hash-chain and source-body hash helpers.

`@khoralabs/memories-core` re-exports these APIs for compatibility, but storage packages should import this package directly.

## Exports

| Subpath | Contents |
| --- | --- |
| `.` | Stable IDs, namespace helpers, label/search payload types, persistence contracts, provenance helpers |
| `./persistence` | Row schemas, persistence interfaces, backend capabilities, sync-to-async adapter |
| `./provenance` | Canonical JSON, source body hashes, provenance chain helpers |

## Testing

From the repo root:

```sh
bun test packages/persistence/core
```
