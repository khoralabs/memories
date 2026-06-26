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

const ontologyClient = new MemoriesOntologyClient({
  serviceClient: new MemoriesServiceClient({ baseUrl, auth }),
});
const currentHash = await ontologyClient.getDatabaseHash(database);

const memories = await createRemoteMemoriesClientAsync({ baseUrl, database, ontology, auth });
await memories.search({ namespace, content, options });

const reads = createRemoteMemoriesReadClient({ baseUrl, database, auth });
await reads.listNamespaces();
```

## Projection worker input

When the HTTP service is configured with a projection source, workers can fetch compressed UMAP input and run layout locally:

```ts
import { buildNamespaceGraphLayoutFromUmapInput } from "@khoralabs/memories-projections";

const reads = createRemoteMemoriesReadClient({ baseUrl, database, auth });
const input = await reads.fetchUmapInput({ namespace, scope: "subtree" });
const layout = buildNamespaceGraphLayoutFromUmapInput(input);
```

See [../roadmap/http-memory-apis.md](../roadmap/http-memory-apis.md).
