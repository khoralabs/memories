# HTTP memory APIs

Expose Memories persistence operations over HTTP, beyond today's management-only routes.

**Status:** HTTP adapter exposes database lifecycle only (`/databases`, `/databases/open`, etc.). No search, merge, or graph routes. No remote `MemoriesPersistenceAsync` in the client package.

## Two client stories

| Client | Purpose | Status |
|--------|---------|--------|
| Management | List/open/delete/checkpoint databases | Shipped (`MemoriesServiceClient`) |
| Runtime persistence | Search, merge, read graph inside a database | Not shipped |

## Possible HTTP surface

Early sketch from the original research (not implemented):

```text
POST /databases/open                    # shipped
POST /databases/{...}/memories/search   # proposed
POST /databases/{...}/memories/merge    # proposed
GET  /databases/{...}/memories/graph    # proposed
```

Prefer stable paths with database id in the JSON body (same as management routes) rather than embedding raw owner keys in URLs.

## Auth interaction

Memory routes need `read` / `write` authorization per database and optionally per namespace. DID grants and app-policy both use the existing `namespace?` field on `authorize()`.

Implement management routes first (done), then add memory routes once a host needs remote persistence without embedding the service in-process.

## Runtime persistence client

Optional `@khoralabs/memories-service-client` extension:

```ts
// proposed
createRemoteMemoriesPersistence(client, databaseId): MemoriesPersistenceAsync
```

Maps core persistence methods to HTTP calls. Only worth building when Exedra or another host consumes it.

## Open questions

- Fine-grained persistence ops vs higher-level memory APIs only?
- Streaming for large merge payloads?
- Provenance verification across nodes vs per-database hash chain only?
