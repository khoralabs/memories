# @khoralabs/memories

Knowledge-graph memory store for agents and apps: hybrid lexical + vector search, graph topology, provenance, and LLM agent tooling. This repo is a **Bun workspace** of TypeScript packages that implement the memories system end to end.

## Packages

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-core` | [`packages/core`](packages/core) | Contracts, `MemoriesClient`, merge/search/delete, IDs, provenance |
| `@khoralabs/memories-sqlite` | [`packages/persistence/sqlite`](packages/persistence/sqlite) | Reference SQLite backend (FTS5 + sqlite-vec) |
| `@khoralabs/memories-ontologies` | [`packages/ontologies`](packages/ontologies) | Default ontology vocabulary (people, places, facts, …) |
| `@khoralabs/memories-autolink` | [`packages/autolink`](packages/autolink) | Search-then-link graph integration |
| `@khoralabs/memories-spec` | [`packages/spec`](packages/spec) | Smithy wire model for persistence |
| `@khoralabs/memories-react-graph` | [`packages/react/graph`](packages/react/graph) | React 3D graph search + investigator UI |
| `@khoralabs/memories-adapter` | [`packages/agents/adapter`](packages/agents/adapter) | Domain object → memory draft agent |
| `@khoralabs/memories-integrator` | [`packages/agents/integrator`](packages/agents/integrator) | Search + structured merge-plan agent |
| `@khoralabs/memories-investigator` | [`packages/agents/investigator`](packages/agents/investigator) | Multi-step Q&A over memories |
| `@khoralabs/memories-tools` | [`packages/agents/tools`](packages/agents/tools) | `memory_search` toolkit for agent sessions |

External dependencies used at runtime:

- [`@khoralabs/sourcemaps`](https://github.com/khoralabs/sourcemaps) — generic ref → resolve types for source-map content
- [`@khoralabs/agent-capabilities`](https://github.com/khoralabs/agent-capabilities) — agent registry and tool loops (agent packages)
- [`@khoralabs/sqlite-crypto`](https://github.com/khoralabs/sqlite-utils), [`@khoralabs/sqlite-migrate`](https://github.com/khoralabs/sqlite-utils) — encrypted DB + migrations (SQLite backend)

## Quick start

```bash
bun install
bun run typecheck
bun test
```

### Minimal SQLite usage

```ts
import { MemoriesClient, namespacePath } from "@khoralabs/memories-core";
import { canonicalOntology } from "@khoralabs/memories-ontologies";
import {
  createMemoriesPersistence,
  openMemoriesDatabase,
} from "@khoralabs/memories-sqlite";

const db = openMemoriesDatabase(":memory:", { sqlCipherKey: "test-key" });
const persistence = createMemoriesPersistence(db);
const client = new MemoriesClient(canonicalOntology, { persistence });

await client.mergeMemory({
  namespace: namespacePath("demo"),
  key: "note-1",
  kind: "node",
  content: [{ key: "body", text: "Project X ships in Q3." }],
});
```

## Development

| Script | Description |
|--------|-------------|
| `bun run typecheck` | Typecheck all workspace packages |
| `bun test` | Run tests across the repo |
| `bun run check` | Biome lint + format check |
| `bun run format` | Auto-fix with Biome |

SQLite tests that load **sqlite-vec** need a SQLite build with dynamic extension loading. Bun’s bundled SQLite often does not qualify. Before `bun test`, set `SQLITE_CUSTOM_LIB` to a system `libsqlite3` (on macOS: `brew install sqlite`, then `export SQLITE_CUSTOM_LIB="$(brew --prefix sqlite)/lib/libsqlite3.dylib"`). See [`packages/persistence/sqlite/README.md`](packages/persistence/sqlite/README.md).

## Architecture

A **memory** is keyed by `(namespace, key)` with `kind: "node" | "edge"`. Each memory has **source maps** (one per content chunk) indexed for lexical and vector search. Core merges results with **Reciprocal Rank Fusion (RRF)** and exposes graph neighbors, provenance, and optional external content resolution via `@khoralabs/sourcemaps`.

For the full system guide — mental model, schema, indexing, and agent integration — see [`packages/README.md`](packages/README.md).

## License

MIT — see [LICENSE](LICENSE).
