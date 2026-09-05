# @khoralabs/memories

Embedded agent memory: a typed knowledge-graph store that agents write to, search, and reason over at runtime. Memories are keyed nodes and edges in an ontology graph, indexed for hybrid lexical + vector retrieval, and linked by a provenance chain so every mutation is auditable.

## Why this exists

Agent sessions need durable, queryable memory that is more than a chat log or a blob store. Memories treats memory as a **graph of ontology-typed facts** with:

- **Hybrid search** — BM25 (FTS5) and KNN (sqlite-vec) fused with Reciprocal Rank Fusion, plus optional neighbor expansion.
- **Typed ontology** — Zod / Standard Schema label maps so merges validate structure, not free-form JSON.
- **Provenance** — an append-only hash chain (`root_hex`) committed with each merge/delete; readers can snapshot and reconstruct.
- **Source maps** — indexed projections (text + vectors) separated from optional canonical content via [`@khoralabs/sourcemaps`](https://github.com/khoralabs/sourcemaps).

The design keeps a **single-database node** (`@khoralabs/memories-node`) independent of **multi-tenant lifecycle** (`@khoralabs/memories-service`), so you can embed a local store in-process or front many principal databases over HTTP.

## Packages

| Package | Path | Role |
|---------|------|------|
| [`@khoralabs/memories-node`](packages/node) | `packages/node` | Single memory node: client, ontology, persistence contracts, backends, projections, attestation, autolink |
| [`@khoralabs/memories-service`](packages/service) | `packages/service` | Multi-tenant service: lifecycle, placement, HTTP, auth, storage stacks |
| [`@khoralabs/memories-agents`](packages/agents) | `packages/agents` | Agent toolkit + adapter / integrator / investigator |
| [`@khoralabs/memories-spec`](packages/spec) | `packages/spec` | Smithy IDL for persistence + public API capability modules |

React UI: install from the [`khoralabs/react`](https://github.com/khoralabs/react) registry (`bunx shadcn@latest add khoralabs/react/memories`). Host port: `@khoralabs/memories-service/react-client` (factory: `…/react-client/service`).

### Layering

```text
memories-spec          Smithy IDL (docs / capability modules; not a TS runtime dep)
        │
memories-node          Single DB: client, ontology, backends, attestation, autolink, projections
        ├──────────────┬─────────────────────┐
        ▼              ▼                     ▼
memories-service   memories-agents      host apps
  multi-DB + HTTP    tools / agents     (khoralabs/react registry)
  placement + auth
```

`./sqlite` and `./storage/sqlite` use `bun:sqlite` and require [Bun](https://bun.sh). Shared roots (`.`, `./client`, `./ontology`, agents) are Bun-free — use `./libsql` or `./turso-serverless` on Node.

### Install matrix (backends)

Heavy drivers are **optional peerDependencies** of `@khoralabs/memories-node`. Install only what you import:

| Import | Runtime | Peers |
|--------|---------|-------|
| `@khoralabs/memories-node/sqlite` | **Bun** | `sqlite-vec`, `@khoralabs/sqlite-crypto`, `@khoralabs/sqlite-migrate`, `ajv` |
| `@khoralabs/memories-node/libsql` | Node / Bun | `@libsql/client`, `ajv` |
| `@khoralabs/memories-node/turso-serverless` | Node / Bun | `@tursodatabase/serverless`, `ajv` |
| `@khoralabs/memories-node/projections` | Node / Bun | `umap-js` |
| `@khoralabs/memories-node/projections/projection-input` | Node / Bun | _(none — wire codec only)_ |
| `@khoralabs/memories-node/autolink` | Node / Bun | `workflow` (for `./autolink/workflows`) |

External runtime dependencies:

- [`@khoralabs/sourcemaps`](https://github.com/khoralabs/sourcemaps) — indexed projections vs canonical source content
- [`@khoralabs/agent-capabilities`](https://github.com/khoralabs/agent-capabilities) — agent registry / tool loops used by `memories-agents`
- [`@khoralabs/sqlite-crypto`](https://github.com/khoralabs/sqlite-utils), [`@khoralabs/sqlite-migrate`](https://github.com/khoralabs/sqlite-utils) — encrypted DB + migrations for SQLite

## Quick start

```bash
bun install
bun run typecheck
bun test
```

### Minimal SQLite usage

```ts
import { MemoriesClient, namespacePath } from "@khoralabs/memories-node";
import { defineOntology } from "@khoralabs/memories-node/ontology/core";
import { canonicalEntityNodeLabelShapes } from "@khoralabs/memories-node/ontology/families/entities";
import { canonicalKnowledgeNodeLabelShapes } from "@khoralabs/memories-node/ontology/families/knowledge";
import { canonicalRelationEdgeLabelShapes } from "@khoralabs/memories-node/ontology/families/relations";
import {
  createMemoriesPersistence,
  openMemoriesDatabase,
} from "@khoralabs/memories-node/sqlite";

const ontology = defineOntology({
  nodeLabels: {
    ...canonicalEntityNodeLabelShapes,
    ...canonicalKnowledgeNodeLabelShapes,
  },
  edgeLabels: {
    ...canonicalRelationEdgeLabelShapes,
  },
});
// Or compose packaged ontologies with mergeOntologies(...) from ./ontology

const db = openMemoriesDatabase(":memory:", { sqlCipherKey: "test-key" });
const persistence = createMemoriesPersistence(db);
const client = new MemoriesClient(persistence, ontology);

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

## Architecture (brief)

A **memory** is keyed by `(namespace, key)` with `kind: "node" | "edge"`. Each memory has one or more **source maps** (one per content chunk), each indexed for lexical and/or vector search. Graph topology (labels, edges, scopes) is stored alongside. On merge, the store clears the old subtree, rewrites topology and indexes, syncs system meta chunks, and appends a provenance event. The chain head (`root_hex`) is committed in the same transaction as the mutation.

Search fuses BM25 and KNN with **RRF**; arm weights are tunable. Graph neighbors can be expanded per query. The SQL backends (sqlite, libsql, turso-serverless) append tip content to `memory_tip_outbox` / `memory_tip_blobs` (`facet='content'`) for point-in-time reconstruction (`getMemoryContentAtRootHex` / `reconstructStoreAtRootHex`).

**Deeper guide** — mental model, schema, merge/search pipelines, and file map: [`packages/README.md`](packages/README.md).

**Service design** — multi-tenant ids, placement, ontology registry, HTTP: [`packages/service/spec.md`](packages/service/spec.md).

**Persistence contract** — implementor semantics: [`packages/node/src/persistence/IMPLEMENTORS.md`](packages/node/src/persistence/IMPLEMENTORS.md).

## Development

| Script | Description |
|--------|-------------|
| `bun run typecheck` | Typecheck primary packages |
| `bun run assert` | Entrypoint isolation checks (`bun:sqlite` leaks, storage entry, browser entry) |
| `bun test` | Run tests across the repo |
| `bun run check` | Biome lint + format check |
| `bun run format` | Auto-fix with Biome |

SQLite tests that load **sqlite-vec** need a SQLite build with dynamic extension loading. Before `bun test`, set `SQLITE_CUSTOM_LIB` to a system `libsqlite3`:

```bash
brew install sqlite
export SQLITE_CUSTOM_LIB="$(brew --prefix sqlite)/lib/libsqlite3.dylib"
```

## Releasing

Packages share a **unified version**. Publish via GitHub Actions:

1. Ensure the `NPM_TOKEN` repository secret can publish to `@khoralabs` on npm (mapped to `NPM_CONFIG_TOKEN` for `bun publish`).
2. Run **Actions → Release → Run workflow**:
   - `version`: semver without `v` (e.g. `0.5.0`)
   - `dry_run`: bump/check without publishing
3. Or push a git tag `vX.Y.Z` (publishes that version).

Local helpers:

```bash
bun run build                              # bun bundle JS + tsc declarations into dist/
bun run release bump 0.5.0
bun run release publish --dry-run
bun run release publish                    # build + publish; requires NPM_CONFIG_TOKEN or NPM_TOKEN
```

Publish ships `dist/` (JavaScript from `bun build`, `.d.ts` from `tsc --emitDeclarationOnly`). Workspace `exports` still point at `src/` for local Bun; the publish script rewrites them to `dist/` for npm.

Publish order is defined by `PUBLISH_ORDER` in [`scripts/build.ts`](scripts/build.ts) (node → otel → service → agents → spec). React UI lives in the [`khoralabs/react`](https://github.com/khoralabs/react) registry.

## License

MIT — see [LICENSE](LICENSE).
