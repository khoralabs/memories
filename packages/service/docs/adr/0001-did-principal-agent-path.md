# ADR 0001: DID principal agent path for memories-service

## Status

Accepted

## Context

Cross-repo decision: khoralabs workspace `auth-normalization.md` — agents authenticate with DID at shared infra HTTP APIs; shared admin Bearer remains a selectable deployment scheme.

`@khoralabs/memories-service` already ships `did-principal` (host-injected proof verify; owner = `database.ownerKey`). Gaps blocked the product path:

- No in-tree `X-Agent-*` verify/sign (hosts had to wire private `@khoralabs/khora-auth`).
- Unscoped routes (`GET /databases`, ontology) called `authorize` without `database` → hard 403.
- Agent client helpers required `adminToken` / Bearer even when the host used DID auth.

Memories keeps **one auth scheme per process** (`none` | `server-admin` | `app-policy` | `did-principal`), unlike chat’s dual gate.

## Decision

We will:

1. Ship khora/relay-compatible `X-Agent-*` wire helpers and `createDidKeyPrincipalVerifier` inside memories-service (no khora-auth dependency).
2. Under `did-principal`, allow authenticated principals on **unscoped** authorize; filter `GET /databases` to `ownerKey === actor.subject`; allow ontology register/get/list for any authenticated DID.
3. Add `createDidSignedRequestAuthProvider(signer)` and make agent client helpers accept `signer` / `auth` without requiring `adminToken`.
4. Keep `server-admin` / `none` / Bearer clients unchanged.

Membership/invite and admin DID groups for placement ops are deferred. Hosts that expose a `did-principal` service publicly without network isolation allow any `did:key` to register ontology and open their own account DBs.

## Consequences

### Positive

- Agents can own and write account DBs with the same DID envelope as khora/relay/chat.
- Operators may still run `server-admin` behind a trust boundary.

### Negative

- Wire code is duplicated across repos until a shared package exists.
- Unscoped ontology register is open to any authenticated DID (mitigate with private network or `server-admin`).

### Neutral

- agent-net harness/reference host adoption is a follow-up.
- Version bump / publish is separate from these implementation commits.
