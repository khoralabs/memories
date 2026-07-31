# @khoralabs/memories-service

Multi-tenant memory service: open/list/delete databases per principal, route each id through a placement store to a node backend, expose HTTP + remote clients, and keep auth outside the pure lifecycle core.

Depends on [`@khoralabs/memories-node`](../node) for the data plane.

## Entrypoints

| Export | Contents |
|--------|----------|
| `.` | Lifecycle service, database ids, placement/ontology store interfaces, composite backend factory |
| `./client` | Management client, `RemoteMemoriesClientAsync`, `RemoteMemoriesReadClient`, `MemoriesOntologyClient` |
| `./http` | `createMemoriesServiceHttpServer` / request handler (lifecycle, persistence, reads, ontology, attribution) |
| `./auth` | `none`, `server-admin`, `app-policy` (+ env factory for `none` / `server-admin`) |
| `./storage/sqlite` | Local SQLite backend (optional SQLCipher), placement + ontology + database catalog registries, `createLocalSqliteServiceStack` (**Bun**) |
| `./storage/libsql` | Local libSQL backend factory; Node-safe |
| `./storage/turso-serverless` | Turso serverless backend factory; Node-safe |
| `./testing` | Conformance runners |

Attestation formats for HTTP attribution live in `@khoralabs/memories-node/attestation`.

## Concepts

**Database identity** — `{ kind, ownerKey }`. `ownerKey` is opaque (DID, tenant id, UUID, …). The service validates shape, not meaning.

**Placement** — control plane (`MemoriesDatabasePlacementStore`) is independent of the node data plane. Default + per-id overrides map to strategies (`sqlite` | `libsql` | `turso-serverless` | custom). Composite factories wire mixed backends.

**Ontology registry (phase 1)** — content-addressed register/link/history over HTTP; merge enforcement and runtime rehydration from stored JSON are still open.

**Auth (shipped)** — `none`, `server-admin`, `app-policy` (host-wired). HTTP-safe contributor attribution signs `khora.http-request-v1` server-side. Planned: `did-principal`, placement admin HTTP, remote node backend — see [roadmap](./roadmap/README.md).

## Telemetry

Pass a `MemoriesTelemetry` sink into the service (typically from [`@khoralabs/memories-otel`](../otel)). The service:

1. Emits **database lifecycle** events: `open` (cache miss), `close`, `delete`, `evict` (LRU)
2. Binds `memories.database.kind` / `owner_key` onto each open handle’s sink
3. Threads that sink into HTTP merge / search / delete so node ops are correlated per database

Libraries do not start an OTel SDK — bring your own Tracer (and optional Meter / Pino logger). The service is an aggregator/enricher, not an OpenTelemetry Collector.

```ts
import { createMemoriesOtelTelemetry } from "@khoralabs/memories-otel";
import { createLocalSqliteServiceStack } from "@khoralabs/memories-service/storage/sqlite";
import { createMemoriesServiceHttpServer } from "@khoralabs/memories-service/http";
import { createServerAdminAuthStrategy } from "@khoralabs/memories-service/auth";
import { trace } from "@opentelemetry/api";

const telemetry = createMemoriesOtelTelemetry({
  tracer: trace.getTracer("memories-service"),
});

const { service, ontology } = createLocalSqliteServiceStack({
  dataDir: "./data",
  ...(process.env.SQLCIPHER_KEY
    ? { sqlCipherKey: process.env.SQLCIPHER_KEY }
    : {}),
  telemetry,
});

const server = createMemoriesServiceHttpServer({
  service,
  ontology,
  auth: createServerAdminAuthStrategy({ adminToken: process.env.ADMIN_TOKEN! }),
});
```

Or pass `telemetry` to `createMemoriesDatabaseService({ resolver, telemetry })` when composing the stack yourself. Attribute catalog and metrics: [`../otel/README.md`](../otel/README.md). Networked ingest (`POST /telemetry/events`) is planned — see [roadmap](./roadmap/README.md#telemetry-event-ingest-phase-2).

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
  ...(process.env.SQLCIPHER_KEY
    ? { sqlCipherKey: process.env.SQLCIPHER_KEY }
    : {}),
});
const server = createMemoriesServiceHttpServer({
  service,
  ontology,
  auth: createServerAdminAuthStrategy({ adminToken: process.env.ADMIN_TOKEN! }),
});
```

Bun-only for `./storage/sqlite`. Omit `sqlCipherKey` for plaintext SQLite; set `SQLCIPHER_KEY` (or pass `sqlCipherKey`) to enable SQLCipher. Use libSQL / Turso storage entrypoints on Node.

### App policy auth

When `MEMORIES_SERVICE_AUTH=app-policy`, construct the strategy at server creation (env alone cannot build it):

```ts
import {
  createAppPolicyAuthStrategy,
  readAuthSchemeFromEnv,
  createAuthStrategyFromEnv,
} from "@khoralabs/memories-service/auth";

const scheme = readAuthSchemeFromEnv();
const auth =
  scheme === "app-policy"
    ? createAppPolicyAuthStrategy({
        async authenticate(req) {
          // host identity (session, JWT, …)
          return { scheme: "app-policy", subject: "user-1" };
        },
        async authorize({ actor, action, database, namespace }) {
          // host team/org + namespace rules; throw AuthStrategyError on deny
        },
      })
    : createAuthStrategyFromEnv();
```
