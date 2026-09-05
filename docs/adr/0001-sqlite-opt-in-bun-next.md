# ADR 0001: SQLite natives stay opt-in; Bun + Next externalization

## Status

Accepted

## Context

`bun:sqlite` and optional `sqlite-vec` break Node and Next bundling if pulled through
package root barrels. Next under Bun also needs explicit `serverExternalPackages`
and may require direct deps for hashed external islands.

## Decision

We will keep SQLite natives behind `@khoralabs/memories-node/sqlite` and
`@khoralabs/memories-service/storage/sqlite` only, guard with boundary tests, and
document Bun + Next `serverExternalPackages` (plus island peer-deps) in package READMEs.

## Consequences

### Positive

- Root / HTTP-contract / client-http graphs stay free of Bun SQLite.
- Hosts have a clear Next embedding checklist.

### Negative

- Apps must opt into sqlite entrypoints and Next config.

### Neutral

- libSQL / Turso entrypoints remain the Node-safe path.
