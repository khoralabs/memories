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

**Projection export:** `POST /databases/projections/umap-input` returns compressed UMAP input rows for an external projection worker. Configure `projectionSource` when creating the server:

```ts
import { createSqliteGraphProjectionSource } from "@khoralabs/memories-projections-sqlite";

createMemoriesServiceHttpServer({
  service,
  ontology,
  auth: createNoneAuthStrategy(),
  projectionSource: ({ handle }) =>
    handle.sqlite ? createSqliteGraphProjectionSource(handle.sqlite.db) : undefined,
});
```

**Ontology:** `POST /ontologies/register`, `get`, `databases`; `POST /databases/hash`; `POST /databases/ontology/link`, `current`, `history`

Full route list: [../spec.md](../spec.md).

## Server-side contributor attribution

Configure `attribution` to have the server sign a `khora.http-request-v1` attestation on every merge and delete, binding the authenticated actor's principal to the request. Client-supplied `contributor` fields are always stripped regardless of whether attribution is configured.

```ts
import { createMemoriesServiceHttpServer } from "@khoralabs/memories-service-http";
import { createServerAdminAuthStrategy } from "@khoralabs/memories-service-auth";

createMemoriesServiceHttpServer({
  service,
  auth: createServerAdminAuthStrategy(token),
  attribution: {
    sign: myServerKey.sign,          // caller-supplied — any signing backend
    alg: "EdDSA",
    keyId: "did:key:z-server#key",
    principalForActor: (actor) => `${actor.scheme}:${actor.subject}`,
    now: () => new Date(),            // optional, defaults to Date
  },
});
```

When `attribution` is configured:

1. Auth runs first; the returned `AuthenticatedActor` determines the principal
2. A `khora.http-request-v1` attestation is built over `method`, `path`, `SHA-256(body)`, and `issuedAt`
3. The attestation is stored as `contributor` inside `event_json` in `memory_provenance`
4. Top-level `intentSnapshotId` from the request body is written to the `intent_snapshot_id` column

When `attribution` is absent, writes are unattributed — contributor spoofing is still rejected, but no server attestation is recorded.

### `principalForActor`

The default principal is `"${actor.scheme}:${actor.subject}"` (e.g. `"server-admin:local"`, `"none:local"`). Override to map to a DID or other identifier once `did-principal` auth ships:

```ts
principalForActor: (actor) => actor.subject  // actor.subject will be the verified DID
```

See [../roadmap/decentralized-principal-auth.md](../roadmap/decentralized-principal-auth.md) for the DID auth roadmap.
