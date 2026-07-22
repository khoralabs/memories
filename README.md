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

Public surface (runtime + IDL + contract leaf):

| Package | Path | Role |
|---------|------|------|
| `@khoralabs/memories-node` | [`packages/node`](packages/node) | Individual memory node: client, ontology, persistence contracts, backends, projections, attestation, autolink |
| `@khoralabs/memories-service` | [`packages/service`](packages/service) | Multi-tenant service: lifecycle, HTTP, auth, storage backends |
| `@khoralabs/memories-agents` | [`packages/agents`](packages/agents) | Agents: `./tools`, `./adapter`, `./integrator`, `./investigator` |
| `@khoralabs/memories-react-graph` | [`packages/react/graph`](packages/react/graph) | React 3D graph UI (host-injected projection/search) |
| `@khoralabs/memories-spec` | [`packages/spec`](packages/spec) | Smithy wire model |

### Entrypoints

| Package | Entrypoints |
|---------|-------------|
| `memories-node` | `.`, `./ontology`, `./ontology/families/*`, `./sqlite` (**Bun only**), `./libsql`, `./turso-serverless`, `./projections`, `./projections/umap-input`, `./attestation`, `./autolink`, `./testing` |
| `memories-service` | `.`, `./client`, `./http`, `./auth`, `./storage/sqlite` (**Bun only**), `./storage/libsql`, `./storage/turso-serverless`, `./testing` |
| `memories-agents` | `./tools`, `./adapter`, `./integrator`, `./investigator` |

`./sqlite` and `./storage/sqlite` use `bun:sqlite` and require the [Bun](https://bun.sh) runtime. Shared package roots (`.`, `./client`, `./ontology`, agents) are Bun-free — use `./libsql` or `./turso-serverless` on Node.

### Install matrix (backends)

Heavy drivers are **optional peerDependencies** of `@khoralabs/memories-node`. Install only what you import:

| Import | Runtime | Peers |
|--------|---------|-------|
| `@khoralabs/memories-node/sqlite` | **Bun** | `sqlite-vec`, `@khoralabs/sqlite-crypto`, `@khoralabs/sqlite-migrate`, `ajv` |
| `@khoralabs/memories-node/libsql` | Node / Bun | `@libsql/client`, `ajv` |
| `@khoralabs/memories-node/turso-serverless` | Node / Bun | `@tursodatabase/serverless`, `ajv` |
| `@khoralabs/memories-node/projections` | Node / Bun | `umap-js` |
| `@khoralabs/memories-node/projections/umap-input` | Node / Bun | _(none — wire codec only)_ |
| `@khoralabs/memories-node/autolink` | Node / Bun | `workflow` (for `./autolink/workflows`) |

External runtime dependencies:

- [`@khoralabs/sourcemaps`](https://github.com/khoralabs/sourcemaps) — separates indexed projections from canonical source content; `Store.resolve()` fetches originals on demand
- [`@khoralabs/agent-capabilities`](https://github.com/khoralabs/agent-capabilities) — agent registry, tool loops, and composable toolkit primitives used by agent packages
- [`@khoralabs/sqlite-crypto`](https://github.com/khoralabs/sqlite-utils), [`@khoralabs/sqlite-migrate`](https://github.com/khoralabs/sqlite-utils) — encrypted DB and schema migrations for the SQLite backend

## Quick start

```bash
bun install
bun run typecheck
bun test
```

### Minimal SQLite usage

```ts
import { MemoriesClient, namespacePath } from "@khoralabs/memories-node";
import { canonicalOntology } from "@khoralabs/memories-node/ontology";
import {
  createMemoriesPersistence,
  openMemoriesDatabase,
} from "@khoralabs/memories-node/sqlite";

const db = openMemoriesDatabase(":memory:", { sqlCipherKey: "test-key" });
const persistence = createMemoriesPersistence(db);
const client = new MemoriesClient(persistence, canonicalOntology);

await client.mergeMemory({
  namespace: namespacePath("demo"),
  key: "note-1",
  kind: "node",
  content: [{ key: "body", text: "Project X ships in Q3." }],
});
```

### Attaching memory search to an agent session

```ts
import { memorySearchToolkit } from "@khoralabs/memories-agents/tools";
import { MemoryInvestigatorClient } from "@khoralabs/memories-agents/investigator";

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
| `bun run typecheck` | Typecheck primary packages |
| `bun run assert:no-bun-sqlite-leak` | Fail if `bun:sqlite` imports leak outside Bun-only entrypoints |
| `bun test` | Run tests across the repo |
| `bun run check` | Biome lint + format check |
| `bun run format` | Auto-fix with Biome |

SQLite tests that load **sqlite-vec** need a SQLite build with dynamic extension loading. Before `bun test`, set `SQLITE_CUSTOM_LIB` to a system `libsqlite3`:

```bash
brew install sqlite
export SQLITE_CUSTOM_LIB="$(brew --prefix sqlite)/lib/libsqlite3.dylib"
```

See [`packages/node/README.md`](packages/node/README.md) (`./sqlite`) for details.

## Releasing

Packages share a **unified version**. Publish via GitHub Actions:

1. Ensure the `NPM_TOKEN` repository secret can publish to `@khoralabs` on npm (mapped to `NPM_CONFIG_TOKEN` for `bun publish`).
2. Run **Actions → Release → Run workflow**:
   - `version`: semver without `v` (e.g. `0.2.0`)
   - `dry_run`: bump/check without publishing
3. Or push a git tag `vX.Y.Z` (publishes that version).

Local helpers:

```bash
bun run build                              # bun bundle JS + tsc declarations into dist/
bun run release:bump 0.2.0
bun run release:publish --dry-run
bun run release:publish                    # build + publish; requires NPM_CONFIG_TOKEN or NPM_TOKEN
```

Publish ships `dist/` (JavaScript from `bun build`, `.d.ts` from `tsc --emitDeclarationOnly`). Workspace `exports` still point at `src/` for local Bun; the publish script rewrites them to `dist/` for npm.

Publish order is defined in [`scripts/publishable-packages.ts`](scripts/publishable-packages.ts) (node → service → agents → react-graph → spec).

## License

MIT — see [LICENSE](LICENSE).
