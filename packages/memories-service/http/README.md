# @khoralabs/memories-service-http

HTTP adapter for `@khoralabs/memories-service`.

Wire with `@khoralabs/memories-service-storage-sqlite` for local hosting:

```ts
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service-storage-sqlite";
import { createMemoriesServiceHttpServer } from "@khoralabs/memories-service-http";

const { service } = createLocalSqliteServiceStack({ dataDir, sqlCipherKey });
createMemoriesServiceHttpServer({ service, auth, port: 3000 });
```

Management routes:

- `GET /databases`
- `POST /databases/open`
- `POST /databases/exists`
- `POST /databases/checkpoint`
- `POST /databases/close`
- `DELETE /databases`

Database ids are passed in JSON bodies as `{ kind, ownerKey }`.
