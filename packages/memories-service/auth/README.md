# @khoralabs/memories-service-auth

Authorization strategies for the Memories database service HTTP adapter.

## Shipped schemes

### `none`

No authentication. All requests are accepted and attributed to `{ scheme: "none", subject: "local" }`. Use for local development or trusted internal deployments only.

```text
MEMORIES_SERVICE_AUTH=none
```

### `server-admin`

Bearer token authentication. All requests must include `Authorization: Bearer <token>`.

```text
MEMORIES_SERVICE_AUTH=server-admin
MEMORIES_SERVICE_ADMIN_TOKEN=your-token
```

Configure at startup:

```ts
import { createNoneAuthStrategy, createServerAdminAuthStrategy } from "@khoralabs/memories-service-auth";

const auth = createNoneAuthStrategy();
// or
const auth = createServerAdminAuthStrategy(process.env.MEMORIES_SERVICE_ADMIN_TOKEN!);
```

Both strategies return an `AuthenticatedActor` (`{ scheme, subject, claims? }`) from `authenticate`, which the HTTP adapter uses to build server-side contributor attestations when `attribution` is configured.

## `AuthenticatedActor`

```ts
type AuthenticatedActor = {
  scheme: string;   // e.g. "none", "server-admin", "did-principal"
  subject: string;  // e.g. "local", "admin", or a DID
  claims?: Record<string, unknown>;
};
```

The `subject` becomes the default principal in `khora.http-request-v1` attestations (as `"${scheme}:${subject}"`). Override via `attribution.principalForActor` in `MemoriesServiceHttpOptions`.

## Roadmap

- **`app-policy`** — host-supplied authenticate/authorize callbacks for session-based or organization-scoped access. See [../roadmap/app-policy-auth.md](../roadmap/app-policy-auth.md).
- **`did-principal`** — DID proof verification, delegation grants, portable signed credentials. See [../roadmap/decentralized-principal-auth.md](../roadmap/decentralized-principal-auth.md).
