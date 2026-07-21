# @khoralabs/memories-service

Multi-tenant memory service: lifecycle, placement routing, HTTP, auth, and storage backends.

## Entrypoints

| Export | Contents |
|--------|----------|
| `.` | Lifecycle service + storage contracts (Bun-free) |
| `./client` | HTTP management + remote `MemoriesClientAsync` |
| `./http` | HTTP adapter |
| `./auth` | Auth strategies |
| `./storage/sqlite` | Local SQLite data plane + registries (**Bun required**) |
| `./storage/libsql` | LibSQL data plane; Node-safe |
| `./storage/turso-serverless` | Turso data plane; Node-safe |
| `./testing` | Conformance runners |

See the [root README](../../README.md) for the package map and composition recipes.
