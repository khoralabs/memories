# @khoralabs/memories-service-http

Backend-agnostic HTTP adapter for `@khoralabs/memories-service`.

Wire with any `MemoriesDatabaseService`. For local hosting:

```ts
import { createNoneAuthStrategy } from "@khoralabs/memories-service-auth";
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";
import { createMemoriesServiceHttpServer } from "@khoralabs/memories-service-http";

const { service, ontology } = createLocalSqliteServiceStack({ dataDir, sqlCipherKey });
createMemoriesServiceHttpServer({ service, ontology, auth: createNoneAuthStrategy(), port: 3000 });
```

Pass `ontology` from the stack when ontology HTTP routes are needed.

## Routes

Database ids are passed in JSON bodies as `{ kind, ownerKey }`.

**Lifecycle:** `GET /databases`, `POST /databases/open`, `exists`, `checkpoint`, `close`, `DELETE /databases`

**Persistence:** `POST /databases/search`, `merge`, `delete-memory`, `provenance/head`, `capabilities`

**Reads:** `POST /databases/namespaces`, `edge-preview`, `source-map/text-preview`, `vector-dimensions`, `ensure-scope-chain`, `find-memory-id`, `load-memory-namespace-key`

**Ontology:** `POST /ontologies/register`, `get`, `databases`; `POST /databases/ontology/link`, `current`, `history`

Full route list: [../spec.md](../spec.md) and [../roadmap/http-memory-apis.md](../roadmap/http-memory-apis.md).
