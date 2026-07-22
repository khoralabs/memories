# Roadmap

Feature plans for `@khoralabs/memories-service` and sibling packages.

| Feature | File | Summary | Status |
|---------|------|---------|--------|
| App policy auth | [app-policy-auth.md](./app-policy-auth.md) | Host app decides access | Not implemented |
| Remote backends | [remote-backends.md](./remote-backends.md) | libSQL/Turso, remote nodes | Not implemented |
| Placement admin API | [placement-admin-api.md](./placement-admin-api.md) | HTTP routes for backend overrides | Not implemented |
| Decentralized principal auth | [decentralized-principal-auth.md](./decentralized-principal-auth.md) | DID signatures, grants, credentials | Phase 1 (signing infra) shipped |

## Shipped

- **HTTP memory APIs** — All lifecycle, persistence, read, projection, and ontology routes. Remote client (`RemoteMemoriesClientAsync`, `RemoteMemoriesReadClient`, `MemoriesOntologyClient`). See [`../http/README.md`](../http/README.md) and [`../client/README.md`](../client/README.md).
- **Ontology registry** — Content-addressed registry, per-database link history, HTTP routes, client helpers, host phase-1 link-on-open pattern.
- **HTTP-safe contributor attribution** — Server-side `khora.http-request-v1` attestations built from authenticated actors. Clients pass `intentSnapshotId` only; contributor spoofing is stripped. See [`../http/README.md`](../http/README.md).

Current implementation reference: [../spec.md](../spec.md).
