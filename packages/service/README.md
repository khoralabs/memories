# @khoralabs/memories-service

Multi-tenant memory service: open/list/delete databases per principal, route each id through a placement store to a node backend, expose HTTP + remote clients, and keep auth outside the pure lifecycle core.

Depends on [`@khoralabs/memories-node`](../node) for the data plane.

## Entrypoints

| Export | Contents |
|--------|----------|
| `.` | Lifecycle service, database ids, placement/ontology store interfaces, composite backend factory |
| `./client` | Management client, `RemoteMemoriesClientAsync`, `RemoteMemoriesReadClient`, `MemoriesOntologyClient` |
| `./http` | `createMemoriesServiceHttpServer` / request handler (lifecycle, persistence, reads, ontology, attribution) |
| `./auth` | `none`, `server-admin` (+ env factory) |
| `./storage/sqlite` | Local SQLCipher backend, SQLite placement + ontology registries, `createLocalSqliteServiceStack` (**Bun**) |
| `./storage/libsql` | Local libSQL backend factory; Node-safe |
| `./storage/turso-serverless` | Turso serverless backend factory; Node-safe |
| `./testing` | Conformance runners |

Attestation formats for HTTP attribution live in `@khoralabs/memories-node/attestation`.

## Concepts

**Database identity** — `{ kind, ownerKey }`. `ownerKey` is opaque (DID, tenant id, UUID, …). The service validates shape, not meaning.

**Placement** — control plane (`MemoriesDatabasePlacementStore`) is independent of the node data plane. Default + per-id overrides map to strategies (`sqlite` | `libsql` | `turso-serverless` | custom). Composite factories wire mixed backends.

**Ontology registry (phase 1)** — content-addressed register/link/history over HTTP; merge enforcement and runtime rehydration from stored JSON are still open.

**Auth (shipped)** — `none`, `server-admin`. HTTP-safe contributor attribution signs `khora.http-request-v1` server-side. Planned: app-policy, `did-principal`, placement admin HTTP, remote node backend — see [roadmap](./roadmap/README.md).

## Docs

| Doc | Role |
|-----|------|
| [`spec.md`](./spec.md) | Authoritative service architecture |
| [`roadmap/README.md`](./roadmap/README.md) | Shipped vs planned features |
| [`roadmap/decentralized-principal-auth.md`](./roadmap/decentralized-principal-auth.md) | DID auth design |

```ts
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service/storage/sqlite";
import { createMemoriesServiceHttpServer } from "@khoralabs/memories-service/http";
import { createServerAdminAuthStrategy } from "@khoralabs/memories-service/auth";

const { service, ontology } = createLocalSqliteServiceStack({
  dataDir: "./data",
  sqlCipherKey: process.env.SQLCIPHER_KEY!,
});
const server = createMemoriesServiceHttpServer({
  service,
  ontology,
  auth: createServerAdminAuthStrategy({ adminToken: process.env.ADMIN_TOKEN! }),
});
```

Bun-only for `./storage/sqlite`. Use libSQL / Turso storage entrypoints on Node.
