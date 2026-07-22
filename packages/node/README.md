# @khoralabs/memories-node

Individual memory node: `MemoriesClient`, persistence contracts (`.`, `./persistence`, `./provenance`), backends, projections, attestation, and autolink.

## Entrypoints

| Export | Contents |
|--------|----------|
| `.` | Client, merge/search/delete, IDs, provenance (re-exports contracts) |
| `./sqlite` | SQLite persistence + projections (**Bun runtime required** — uses `bun:sqlite`) |
| `./libsql` | LibSQL persistence + projections (+ Turso-local projection helpers); Node-safe |
| `./turso-serverless` | Turso Cloud persistence; Node-safe |
| `./projections` | UMAP/layout math (**requires `umap-js` peer**) |
| `./projections/umap-input` | Wire codec only (encode/decode/collect); no `umap-js` |
| `./attestation` | Contributor attestation |
| `./autolink` | Search-then-link |
| `./testing` | Conformance test runners |

Backend drivers are optional peer dependencies — see the [root README](../../README.md) install matrix.

**Runtime:** `@khoralabs/memories-node/sqlite` requires [Bun](https://bun.sh). Use `./libsql` or `./turso-serverless` on Node and other runtimes. Service / remote clients that only ship UMAP input payloads should import `./projections/umap-input`, not the full `./projections` barrel.
