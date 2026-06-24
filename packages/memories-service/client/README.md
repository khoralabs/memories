# @khoralabs/memories-service-client

HTTP client for the Memories database service management API.

```ts
import { createBearerTokenAuthProvider, MemoriesServiceClient } from "@khoralabs/memories-service-client";

const client = new MemoriesServiceClient({
  baseUrl: "http://localhost:8787",
  auth: createBearerTokenAuthProvider(process.env.MEMORIES_SERVICE_ADMIN_TOKEN!),
});

await client.openDatabase({ kind: "account", ownerKey: "owner-a" });
```
