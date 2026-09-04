# @khoralabs/memories-service

Multi-tenant memory service: open/list/delete databases per principal, route each id through a placement store to a node backend, expose HTTP + remote clients, and keep auth outside the pure lifecycle core.

Depends on [`@khoralabs/memories-node`](../node) for the data plane.

## Entrypoints

| Export | Contents |
|--------|----------|
| `.` | Lifecycle service, database ids, placement/ontology store interfaces, composite backend factory |
| `./client` | Node/operator barrel: management client, remote clients, ontology helpers |
| `./client/http` | Lean HTTP client + `MemoriesServiceClientError` + path/error constants (browser-safe) |
| `./client/ontology` | Ontology register/hash helpers (Node-oriented) |
| `./client/agent` | Agent memories client helpers |
| `./http` | Server: `createMemoriesServiceHttpServer` / request handler (+ re-exports contracts) |
| `./http/contracts` | Paths, error codes, discovery, wire types only (no handlers; browser-safe) |
| `./auth` | `none`, `server-admin`, `app-policy`, `did-principal` (+ env factory for `none` / `server-admin`) |
| `./storage/sqlite` | Local SQLite backend (optional SQLCipher), placement + ontology + database catalog registries, `createLocalSqliteServiceStack` (**Bun**; sqlite-only by default — compose libsql/turso via `backendFactory`) |
| `./storage/libsql` | Local libSQL backend factory; Node-safe |
| `./storage/turso-serverless` | Turso serverless backend factory; Node-safe |
| `./testing` | Conformance runners |

Attestation formats for HTTP attribution live in `@khoralabs/memories-node/attestation`.

## Concepts

**Database identity** — `{ kind, ownerKey }`. `ownerKey` is opaque (DID, tenant id, UUID, …). The service validates shape, not meaning.

**Placement** — control plane (`MemoriesDatabasePlacementStore`) is independent of the node data plane. Default + per-id overrides map to strategies (`sqlite` | `libsql` | `turso-serverless` | custom). Composite factories wire mixed backends.

**Ontology registry (phase 1)** — content-addressed register/link/history over HTTP; merge enforcement and runtime rehydration from stored JSON are still open.

**Auth (shipped)** — `none`, `server-admin`, `app-policy`, `did-principal` (last two host-wired). HTTP-safe contributor attribution signs `khora.http-request-v1` server-side. Planned: placement admin HTTP, remote node backend — see [roadmap](./roadmap/README.md).

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
| [`spec.md`](./spec.md) | Authoritative service architecture (incl. authorize scope + did-principal) |
| [`src/auth/HOST_POLICY.md`](./src/auth/HOST_POLICY.md) | Host grant matching for `app-policy` / `resolveGrants` |
| [`roadmap/README.md`](./roadmap/README.md) | Shipped vs planned features |

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
  authorizeScopeAgainstGrants, // optional reference matcher
} from "@khoralabs/memories-service/auth";

const scheme = readAuthSchemeFromEnv();
const auth =
  scheme === "app-policy"
    ? createAppPolicyAuthStrategy({
        async authenticate(req) {
          // host identity (session, JWT, …)
          return { scheme: "app-policy", subject: "user-1" };
        },
        async authorize({ actor, action, database, scope }) {
          // host team/org + namespace rules via `scope`; throw AuthStrategyError on deny
        },
      })
    : createAuthStrategyFromEnv();
```

Host matching rules: [`src/auth/HOST_POLICY.md`](./src/auth/HOST_POLICY.md).

### DID principal auth

Host-wired only (env cannot construct it). Proof verify is injected — memories does not depend on khora:

```ts
import { createDidPrincipalAuthStrategy } from "@khoralabs/memories-service/auth";
// Host typically adapts @khoralabs/khora-auth verifySignedAgentRequest:
const auth = createDidPrincipalAuthStrategy({
  verify: {
    async verify({ request }) {
      const { did } = await hostVerifySignedRequest(request);
      return { did };
    },
  },
  // optional: resolveGrants: ({ actor, database }) => hostGrants,
});
```

Authorize: owner when `actor.subject === database.ownerKey`; else optional `resolveGrants` matched with `authorizeScopeAgainstGrants`. Attribution: `principalForActor: (actor) => actor.subject`. Details: [`spec.md`](./spec.md#did-principal).
