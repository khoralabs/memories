# App policy auth

Authorization strategy where the embedding application decides access. The Memories service only understands database ids; the host enforces team membership, session scope, organization roles, and namespace rules.

**Status:** Not implemented. Shipped schemes: `none`, `server-admin`.

## Goal

```text
MEMORIES_SERVICE_AUTH=app-policy
```

The HTTP adapter calls into host-provided policy hooks before invoking `MemoriesDatabaseService`. This is the Exedra-shaped mode: Exedra's existing `access.ts` and route-level checks move behind a reusable strategy interface rather than living ad hoc in route handlers.

## Strategy shape

Extend `@khoralabs/memories-service-auth` with something like:

```ts
type AppPolicyAuthStrategyOptions = {
  authenticate(req: Request): Promise<AuthenticatedActor>;
  authorize(input: {
    actor: AuthenticatedActor;
    action: DatabaseAction;
    database?: MemoriesDatabaseId;
    namespace?: string;
  }): Promise<void>;
};
```

The factory receives callbacks or a policy module from the host at startup. The auth package defines the contract; Exedra (or another app) supplies the implementation.

## What stays in the host

- User/session identity from the app's auth system
- Organization and team membership
- Namespace-level read/write rules inside a database
- Exedra-specific ontology and namespace builders

## What stays in the service

- Database open/cache/list/delete/checkpoint
- Backend resolution and placement
- Opaque `{ kind, ownerKey }` ids

## Relationship to DID auth

These strategies are mutually exclusive per service instance. A deployment uses either:

- `server-admin` for operator tools,
- `app-policy` for a monolithic app like Exedra, or
- `did-principal` for decentralized client access

Hybrid deployments (e.g. admin token plus app sessions) would require a composite strategy — out of scope until a concrete host needs it.

## Implementation notes

- Factory: `createAppPolicyAuthStrategy({ authenticate, authorize })`
- Env: document that `app-policy` requires host wiring at server creation time; env alone is insufficient
- Tests: mock policy module in `memories-service-auth`; integration tests in Exedra after migration
