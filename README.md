# @khoralabs/memories

Embedded agent memory; a knowledge-graph store that agents can write to, search, and reason over at runtime. Memories are keyed nodes and edges in a typed ontology graph, indexed for hybrid lexical + vector retrieval, and linked by a provenance chain so every mutation is auditable.

## What it does

An agent session attaches a `MemoriesClient` scoped to a namespace. During a session the agent can:

- **Search** — issue a `memory_search` call; the system runs BM25 (FTS5) and KNN (sqlite-vec) in parallel, fuses results with Reciprocal Rank Fusion, and optionally expands graph neighbors.
- **Integrate** — the integrator agent decomposes new content into ontology-typed memory drafts and merges them into the graph.
- **Investigate** — the investigator agent answers multi-step questions by iterating over `memory_search` calls before synthesising a cited answer.
- **Adapt** — the adapter agent converts raw domain payloads into merge-ready memory drafts according to the ontology.
- **Autolink** — `integrateNewMemoryIntoGraph` searches for related nodes, plans link patches, and merges edge memories to keep the graph connected.

Each memory has one or more **source maps** (one per content chunk), each indexed for both lexical and vector search. Graph topology (labels, edges, scopes) is stored alongside. A cryptographic hash chain records every merge and delete. The chain head (`root_hex`) is committed transactionally with each mutation, so any reader can call `getProvenanceHeadRootHex` at any moment and get a value that is guaranteed to reflect committed store state.

## Packages

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-core` | [`packages/core`](packages/core) | `MemoriesClient`, merge/search/delete, RRF, provenance, stable IDs |
| `@khoralabs/memories-sqlite` | [`packages/persistence/sqlite`](packages/persistence/sqlite) | Reference backend: FTS5 + sqlite-vec, SQLite schema and migrations |
| `@khoralabs/memories-projections` | [`packages/projections/core`](packages/projections/core) | Persistence-agnostic projection interfaces, layout math, and visualization helpers |
| `@khoralabs/memories-projections-sqlite` | [`packages/projections/sqlite`](packages/projections/sqlite) | SQLite projection strategy for local SQLite stores |
| `@khoralabs/memories-projections-turso` | [`packages/projections/turso`](packages/projections/turso) | Turso/libSQL projection strategy for already-local Turso-family stores |
| `@khoralabs/memories-ontologies` | [`packages/ontologies`](packages/ontologies) | Default ontology vocabulary (people, places, facts, …) |
| `@khoralabs/memories-autolink` | [`packages/autolink`](packages/autolink) | Search-then-link graph integration |
| `@khoralabs/memories-spec` | [`packages/spec`](packages/spec) | Smithy wire model for persistence |
| `@khoralabs/memories-tools` | [`packages/agents/tools`](packages/agents/tools) | `memory_search` toolkit for agent sessions |
| `@khoralabs/memories-adapter` | [`packages/agents/adapter`](packages/agents/adapter) | Domain payload → ontology-typed memory draft agent |
| `@khoralabs/memories-integrator` | [`packages/agents/integrator`](packages/agents/integrator) | Decompose + embed + merge agent |
| `@khoralabs/memories-investigator` | [`packages/agents/investigator`](packages/agents/investigator) | Multi-step Q&A over memories |
| `@khoralabs/memories-react-graph` | [`packages/react/graph`](packages/react/graph) | React 3D graph: search, namespace selector, investigator overlay |

External runtime dependencies:

- [`@khoralabs/sourcemaps`](https://github.com/khoralabs/sourcemaps) — separates indexed projections from canonical source content; `Store.resolve()` fetches originals on demand
- [`@khoralabs/agent-capabilities`](https://github.com/khoralabs/agent-capabilities) — agent registry, tool loops, and composable toolkit primitives used by all agent packages
- [`@khoralabs/sqlite-crypto`](https://github.com/khoralabs/sqlite-utils), [`@khoralabs/sqlite-migrate`](https://github.com/khoralabs/sqlite-utils) — encrypted DB and schema migrations for the SQLite backend

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

### Attaching memory search to an agent session

```ts
import { memorySearchToolkit } from "@khoralabs/memories-tools";
import { MemoryInvestigatorClient } from "@khoralabs/memories-investigator";

const inv = new MemoryInvestigatorClient({
  registry,
  namespace: "app/user-1",
  additionalNamespaces: ["app/shared"],
  model,
  client,
  embeddingModel,
});

const { answer } = await inv.investigate({
  question: "What commitments mention Project X?",
  maxSteps: 12,
});
```

## Architecture

A **memory** is keyed by `(namespace, key)` with `kind: "node" | "edge"`. Each memory has one or more **source maps** — one per content chunk — each carrying optional text features (FTS5) and vector features (sqlite-vec). On merge, core clears the old subtree, writes graph topology, indexes each chunk, syncs a `__mem_search_meta__` topology chunk and ontology prop chunks, then appends a provenance event to the hash chain.

Search fuses BM25 and KNN results with **Reciprocal Rank Fusion (RRF)**; the lexical and vector arm weights are independently tunable. Graph neighbors can be expanded per-query via edge label and direction constraints.

A cryptographic hash chain records every merge and delete. The chain head (`root_hex`) is committed transactionally with each mutation, so any reader can call `getProvenanceHeadRootHex` at any moment and get a value that is guaranteed to reflect committed store state. The SQLite backend also writes the actual text content to an append-only `memory_content_outbox` table in the same transaction, enabling point-in-time reconstruction via `getMemoryContentAtRootHex` (single key) or `reconstructStoreAtRootHex` (full store audit).

For the full system guide — mental model, schema, indexing, and agent integration — see [`packages/README.md`](packages/README.md).

## Development

| Script | Description |
|--------|-------------|
| `bun run typecheck` | Typecheck all workspace packages |
| `bun test` | Run tests across the repo |
| `bun run check` | Biome lint + format check |
| `bun run format` | Auto-fix with Biome |

SQLite tests that load **sqlite-vec** need a SQLite build with dynamic extension loading. Before `bun test`, set `SQLITE_CUSTOM_LIB` to a system `libsqlite3`:

```bash
brew install sqlite
export SQLITE_CUSTOM_LIB="$(brew --prefix sqlite)/lib/libsqlite3.dylib"
```

See [`packages/persistence/sqlite/README.md`](packages/persistence/sqlite/README.md) for details.

## License

MIT — see [LICENSE](LICENSE).
