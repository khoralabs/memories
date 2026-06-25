# Exedra integration

Migrate Exedra from inline SQLite database management to `@khoralabs/memories-service` over HTTP.

**Status:** Code migration shipped in Exedra. Remaining work is operational wiring (dev stack, env docs, tests, backup paths), not core APIs.

## What shipped

Exedra now calls a hosted memories service via `EXEDRA_MEMORIES_SERVICE_URL` (optional `EXEDRA_MEMORIES_SERVICE_TOKEN`):

| Area | Exedra location | Notes |
|------|-----------------|-------|
| Service client | `app/src/server/memories/service-client.ts` | `openOrgMemoriesService`, `openUserMemoriesService`, ontology link on open |
| App routes | `org-routes.ts`, `user-routes.ts`, `me-routes.ts`, `api-handlers.ts` | Graph/search via `RemoteMemoriesReadClient` |
| Internal APIs | `http/internal-memories.ts`, `internal-documents.ts` | Merge/search via `RemoteMemoriesClientAsync` |
| Workflows | `workflows/shared/http-memories-client-async.ts`, `integrate-memory/*` | Remote client over HTTP |
| Bootstrap | `bootstrap.ts`, `seed-onboarding.ts` | Scope chains via service read endpoints |
| Local store | `store.ts` | Deprecated; throws without service URL |

Khora vendors packages from `memories/packages/memories-service` at `khora/vendor/memories/packages/memories-service`.

## Database layout

Canonical hosted layout (no legacy path migration required):

```text
{dataDir}/v1/{kind}/{base64url(ownerKey)}/{base64url(ownerKey)}.db
```

Exedra maps principals to `{ kind: "organization" | "account", ownerKey: did }`.

Legacy helpers in `app/src/server/storage/paths.ts` and `memories/paths.ts` remain for Litestream backup paths and should be updated separately.

## Routing layers (preserve distinction)

| Layer | Owner | Concern |
|-------|-------|---------|
| Database routing | Memories service | Which principal database |
| Namespace routing | Exedra app | Org, team, session scope inside a database |
| User authorization | Exedra app | Session, grants, namespace read/write before calling service |

Exedra calls the memories service with `server-admin` (or `none` in local test). User-facing policy stays in Exedra `access.ts`; `app-policy` auth in the service is roadmap work.

## Remaining before production rollout

1. **Dev stack** — add memories-service to `scripts/dev.ts` (like authz/chat)
2. **Env docs** — document `EXEDRA_MEMORIES_SERVICE_URL` / `EXEDRA_MEMORIES_SERVICE_TOKEN` in `.env.example`
3. **Tests** — shared test helper (`test-memories-service.ts` exists; extend to onboarding/seed/route tests)
4. **Backup** — point Litestream at the service data dir (`v1/...` layout), not legacy `{did}/{did}.db` paths
5. **Vendor sync** — keep `khora/vendor/memories` in sync with the `memories` repo

## Non-goals

- Moving team/session namespace design into memories-service
- Changing Exedra's ontology or graph projections
- Exposing the memories service directly to browsers (Exedra remains the policy boundary)

## Related roadmap

- [http-memory-apis.md](./http-memory-apis.md) — shipped HTTP persistence and read routes
- [app-policy-auth.md](./app-policy-auth.md) — only needed if the service is exposed beyond Exedra
- [placement-admin-api.md](./placement-admin-api.md) — HTTP placement overrides for org self-hosted backends
- [ontology-registry.md](./ontology-registry.md) — phase 2 merge enforcement
