# Roadmap

Feature plans for `@khoralabs/memories-service` and sibling packages. Each file describes work that is **not** shipped yet.

| Feature | File | Summary |
|---------|------|---------|
| Ontology registry extensions | [ontology-registry.md](./ontology-registry.md) | HTTP admin, runtime rehydration, merge enforcement (core registry shipped) |
| Decentralized principal auth | [decentralized-principal-auth.md](./decentralized-principal-auth.md) | DID request signatures, delegation grants, portable credentials, revocation logs |
| App policy auth | [app-policy-auth.md](./app-policy-auth.md) | Host app decides access; Exedra-shaped team/session/namespace policy |
| Remote backends | [remote-backends.md](./remote-backends.md) | libSQL/Turso, remote Memories nodes, principal-registered endpoints |
| HTTP memory APIs | [http-memory-apis.md](./http-memory-apis.md) | Search, merge, graph routes and runtime persistence client |
| Exedra integration | [exedra-integration.md](./exedra-integration.md) | Replace Exedra's inline store with these packages |
| Placement admin API | [placement-admin-api.md](./placement-admin-api.md) | HTTP routes to read/write per-principal backend strategies |

Current implementation reference: [../spec.md](../spec.md).
