# @khoralabs/memories-service-client

HTTP client for the Memories database service.

## Management client

```ts
import { createBearerTokenAuthProvider, MemoriesServiceClient } from "@khoralabs/memories-service-client";

const client = new MemoriesServiceClient({
  baseUrl: "http://localhost:8787",
  auth: createBearerTokenAuthProvider(process.env.MEMORIES_SERVICE_ADMIN_TOKEN!),
});

await client.openDatabase({ kind: "account", ownerKey: "owner-a" });
```

## Runtime client (MemoriesClientAsync over HTTP)

```ts
import {
  createBearerTokenAuthProvider,
  createRemoteMemoriesClientAsync,
  createRemoteMemoriesReadClient,
  ensureDatabaseOntologyLink,
  storedOntologyFromDefinition,
} from "@khoralabs/memories-service-client";

const database = { kind: "account", ownerKey: "owner-a" };
const ontology = /* defineOntology(...) */;

await ensureDatabaseOntologyLink({
  serviceClient: new MemoriesServiceClient({ baseUrl, auth }),
  database,
  schema: storedOntologyFromDefinition(ontology),
});

const memories = await createRemoteMemoriesClientAsync({ baseUrl, database, ontology, auth });
await memories.search({ namespace, content, options });
await memories.mergeMemory(params);
await memories.deleteMemory({ namespace, key });

const reads = createRemoteMemoriesReadClient({ baseUrl, database, auth });
await reads.listNamespaces();
await reads.getSourceMapTextPreview(sourceMapId);
```

## Intent snapshot ids

When merging or deleting with an `attribution.intentSnapshotId`, the remote client promotes it to a top-level wire field and strips `attribution.contributor` (contributor is always built server-side):

```ts
await memories.mergeMemory({
  kind: "node",
  key: "note-1",
  namespace: "user/a",
  content: [{ key: "text", text: "hello" }],
  labels: [],
  attribution: { intentSnapshotId: "run-42" },  // sent as top-level intentSnapshotId
});
```

The server writes this to `intent_snapshot_id` in `memory_provenance`. The server's own `khora.http-request-v1` contributor attestation is added independently if the server has `attribution` configured.

## Projection worker input

When the HTTP service is configured with a projection source, workers can fetch compressed UMAP input and run layout locally:

```ts
import { buildNamespaceGraphLayoutFromUmapInput } from "@khoralabs/memories-projections";

const reads = createRemoteMemoriesReadClient({ baseUrl, database, auth });
const input = await reads.fetchUmapInput({ namespace, scope: "subtree" });
const layout = buildNamespaceGraphLayoutFromUmapInput(input);
```
