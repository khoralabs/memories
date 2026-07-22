# Memories Persistence

Persistence contracts and row types live in `@khoralabs/memories-node` (see `src/persistence/core/`, exports `.` / `./persistence` / `./provenance`).

Backend implementations live under [`packages/node/src/persistence`](../node/src/persistence) (`./sqlite`, `./libsql`, `./turso-serverless`).

Read [`IMPLEMENTORS.md`](./IMPLEMENTORS.md) for the storage contract shared by persistence implementations.
