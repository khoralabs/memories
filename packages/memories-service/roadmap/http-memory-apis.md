# HTTP memory APIs

Database-scoped persistence and read operations over HTTP.

**Status:** Shipped. `@khoralabs/memories-service-http` exposes lifecycle, persistence, SQLite read, and ontology routes. `@khoralabs/memories-service-client` provides `createRemoteMemoriesClientAsync`, `createRemoteMemoriesReadClient`, and ontology helpers.

## Two client stories

| Client | Purpose | Status |
|--------|---------|--------|
| Management | List/open/delete/checkpoint databases | Shipped (`MemoriesServiceClient`) |
| Runtime persistence | Search, merge, delete memory, provenance head | Shipped (`RemoteMemoriesClientAsync`) |
| Graph / index reads | Namespaces, graph layout, edge preview, snippets, vector dims | Shipped (`RemoteMemoriesReadClient`) |
| Ontology registry | Register, link, query ontologies | Shipped (`MemoriesOntologyClient`, `ensureDatabaseOntologyLink`) |

## HTTP surface

Database ids are passed in JSON bodies as `{ kind, ownerKey }` (same as management routes).

### Lifecycle

```text
GET    /databases
POST   /databases/open
POST   /databases/exists
POST   /databases/checkpoint
POST   /databases/close
DELETE /databases
```

### Persistence (MemoriesClientAsync)

```text
POST /databases/search
POST /databases/merge
POST /databases/delete-memory
POST /databases/provenance/head
POST /databases/capabilities
```

### Read endpoints

```text
POST /databases/namespaces
POST /databases/edge-preview
POST /databases/source-map/text-preview
POST /databases/vector-dimensions
POST /databases/projections/umap-input
POST /databases/ensure-scope-chain
POST /databases/find-memory-id
POST /databases/load-memory-namespace-key
```

### Ontology registry

```text
POST /ontologies/register
POST /ontologies/get
POST /ontologies/databases
POST /databases/ontology/link
POST /databases/ontology/current
POST /databases/ontology/history
```

## Runtime clients

```ts
import {
  createRemoteMemoriesClientAsync,
  createRemoteMemoriesReadClient,
  ensureDatabaseOntologyLink,
  MemoriesServiceClient,
} from "@khoralabs/memories-service-client";

const client = await createRemoteMemoriesClientAsync({
  baseUrl,
  database: { kind: "account", ownerKey: "owner-a" },
  ontology,
  auth: createBearerTokenAuthProvider(token),
});

await client.search({ namespace, content, options });
await client.mergeMemory(params);

const reads = createRemoteMemoriesReadClient({ baseUrl, database, auth });
await reads.listNamespaces();
await reads.getSourceMapTextPreview(sourceMapId);
await reads.fetchUmapInput({ namespace, scope: "subtree" });
```

Hosts use these clients from backend services, app routes, and workflow adapters.

## Auth interaction

Today, memory routes use the same auth strategy as management (`none` or `server-admin`). Namespace authorization stays in the host app before calling the service.

Future `app-policy` auth would add per-database and per-namespace checks inside the HTTP adapter. See [app-policy-auth.md](./app-policy-auth.md).

## Open questions

- Streaming for large merge payloads?
- Provenance verification across nodes vs per-database hash chain only?
- Passing ontology hash on merge requests for strict registry enforcement?
