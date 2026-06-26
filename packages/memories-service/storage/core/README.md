# @khoralabs/memories-service-storage-core

Shared storage contracts for the Memories database service.

This package owns the storage-layer API that service nodes and storage implementations agree on:

- Database identity and list filters.
- Backend strategy and lifecycle contracts.
- Snapshot artifact contract.
- Placement and ontology control-plane stores.
- Storage-neutral in-memory reference stores.
- Owner-key encoding, validation, and strategy serialization helpers.

`@khoralabs/memories-service` re-exports these APIs for compatibility, but storage implementations should import this package directly.

## Testing

From the repo root:

```sh
bun test packages/memories-service/storage/core
```
