# @khoralabs/memories-node

Individual memory node: `MemoriesClient`, persistence contracts (via `@khoralabs/memories-persistence-core`), backends, projections, attestation, and autolink.

## Entrypoints

| Export | Contents |
|--------|----------|
| `.` | Client, merge/search/delete, IDs, provenance (re-exports contracts) |
| `./sqlite` | SQLite persistence + projections |
| `./libsql` | LibSQL persistence + projections (+ Turso-local projection helpers) |
| `./turso-serverless` | Turso Cloud persistence |
| `./projections` | UMAP/layout math |
| `./attestation` | Contributor attestation |
| `./autolink` | Search-then-link |
| `./testing` | Conformance test runners |

Backend drivers are optional peer dependencies — see the [root README](../../README.md) install matrix.
