# @khoralabs/memories-autolink

Host-side lexical / retrieval linking for **@khoralabs/memories-core** graphs. This package does **not** change core merge or search semantics; it composes `search` / `searchAsync` results into `mergeMemory` edge rows under the **retrieval similarity ontology**.

## Durable integrate workflow

The preferred host API is the durable Workflow SDK entry `autolinkIntegrate`. This package is **world-agnostic**: it never selects a Workflow world backend. The hosting process must configure and start a world before `start(...)`.

- **Local / tests:** [Local World](https://workflow-sdk.dev/worlds/local) — set `WORKFLOW_TARGET_WORLD=local` (CLI default) or use `createLocalWorld` + `setWorld` / `@workflow/vitest`.
- **Production hosts:** e.g. Turso via `@workflow-worlds/turso` (see agent-net reference app).

```ts
import { start } from "workflow/api";
import { provideAutolinkSession, releaseAutolinkSession } from "@khoralabs/memories-autolink";
import { autolinkIntegrate } from "@khoralabs/memories-autolink/workflows";

// Host already configured + started a Workflow world.

const sessionId = crypto.randomUUID();
provideAutolinkSession(sessionId, { client });

try {
  const run = await start(autolinkIntegrate, [
    {
      sessionId,
      namespace: "demo",
      key: "focal",
      content: [{ key: "body", text: "hello" }],
      searchContent: { text: "hello" },
    },
  ]);
  const memoryIds = await run.returnValue;
} finally {
  releaseAutolinkSession(sessionId);
}
```

Or use `startAutolinkIntegrate(params)` from `@khoralabs/memories-autolink/workflows` for the same `start` + `returnValue` convenience.

Non-serializable clients are bound with `provideAutolinkSession` / `requireAutolinkSession` / `releaseAutolinkSession` from the package root. Steps may also take an injected `deps` argument for tests and nested callers. Pure logic lives in `runAutolinkIntegrate` (no Workflow directives).

## Ontology composition

1. Define your primary ontology with `defineOntology`.
2. Merge in the retrieval fragment:

```ts
import {
  canonicalOntology,
  defineOntology,
  mergeOntologies,
  retrievalSimilarityOntology,
} from "@khoralabs/memories-ontologies";

export const appOntology = mergeOntologies(canonicalOntology, retrievalSimilarityOntology);
```

Or spread manually:

```ts
defineOntology({
  nodeLabels: { ...canonicalOntology.nodeLabels, ...retrievalSimilarityOntology.nodeLabels },
  edgeLabels: { ...canonicalOntology.edgeLabels, ...retrievalSimilarityOntology.edgeLabels },
});
```

On **kind collision**, the **last** argument to `mergeOntologies` wins (arguments are merged left to right).

## Pure planner

`computeLexicalLinkMergeSlice(sourceMemoryKey, searchHits, options)` maps ranked `SearchHit[]` to a `{ labels?, edges? }` patch:

- Edges use kind `retrieval_similarity` with `similarityScore`, `searchConfig` (JSON-stable snapshot), optional `rank`, `hitMemoryKey`, `hitSourceKey`.
- Optional node label `retrieval_seed` when `tagSourceNode: true` and at least one edge is emitted.

`normalizeSearchConfigSnapshot` builds `searchConfig` from the same inputs you pass to search (namespace, content mode, `options.*`).

## Idempotency

Storage derives a stable `edgeId` from endpoints, edge label kind, and merge id-parts. Re-running merge for the same focal key, neighbor key, and `retrieval_similarity` kind **updates** the existing edge row. Safe to re-run retrieval linking as long as props remain JSON-serializable.
