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

const reads = createRemoteMemoriesReadClient({ baseUrl, database, auth });
await reads.listNamespaces();
```

See [../roadmap/http-memory-apis.md](../roadmap/http-memory-apis.md).
