# Placement admin API

HTTP routes to read and write per-principal backend strategies without direct access to `MemoriesDatabasePlacementStore`.

**Status:** Placement is programmatic only (`placement.setStrategy`, SQLite registry at `{dataDir}/registry/placements.db`). No HTTP routes.

## Goal

Operators and automation need to:

- Read the default backend strategy
- Set the default strategy
- List per-principal overrides
- Set or remove an override for `{ kind, ownerKey }`

Today this requires in-process calls or direct registry DB access.

## Proposed routes

Sketch (paths and auth TBD):

```text
GET    /placement/default
PUT    /placement/default
GET    /placement/overrides?kind=
PUT    /placement/overrides
DELETE /placement/overrides
```

Bodies use the same `MemoriesDatabaseBackendStrategy` JSON as the placement store. All routes require `manage` (or stricter operator auth).

## Auth

Under `server-admin`, bearer token is sufficient. Under `did-principal`, only principals authorized to manage service configuration should mutate placement — policy TBD when DID auth ships.

## Client

Extend `MemoriesServiceClient` with placement methods once routes exist.

## Dependencies

- Stable strategy JSON serialization (already used in SQLite registry)
- Validation that override strategies reference backends the host has factories for
- Optional: prevent deleting default strategy without replacement

## Non-goals

- Exposing placement through the core service API (stays a host/HTTP concern)
- Cross-service placement replication
