# @khoralabs/memories-autolink

Host-side lexical / retrieval autolinking for **[@khoralabs/memories-core](https://github.com/)** graphs. This package does **not** change core merge or search semantics; it composes `search` / `searchAsync` results into `mergeMemory` edge rows under a small **retrieval-link ontology**.

## Ontology composition

1. Define your primary ontology with `defineOntology`.
2. Merge in the retrieval fragment:

```ts
import { defineOntology } from "@khoralabs/memories-core";
import { canonicalOntology } from "@khoralabs/memories-ontologies";
import { mergeOntologies } from "@khoralabs/memories-core/helpers";
import { retrievalAutolinkOntology } from "@khoralabs/memories-autolink";

export const appOntology = mergeOntologies(canonicalOntology, retrievalAutolinkOntology);
```

Or spread manually:

```ts
defineOntology({
  nodeLabels: { ...canonicalOntology.nodeLabels, ...retrievalAutolinkOntology.nodeLabels },
  edgeLabels: { ...canonicalOntology.edgeLabels, ...retrievalAutolinkOntology.edgeLabels },
});
```

On **kind collision**, the **last** argument to `mergeOntologies` from `@khoralabs/memories-core/helpers` wins (arguments are merged left to right).

## Pure planner

`computeLexicalLinkMergeSlice(sourceMemoryKey, searchHits, options)` maps ranked `SearchHit[]` to a `{ labels?, edges? }` patch:

- Edges use kind `retrieval_autolink` with `similarityScore`, `searchConfig` (JSON-stable snapshot), optional `rank`, `hitMemoryKey`, `hitSourceKey`.
- Optional node label `retrieval_bootstrap` when `tagSourceNode: true` and at least one edge is emitted.

`normalizeSearchConfigSnapshot` builds `searchConfig` from the same inputs you pass to search (namespace, content mode, `options.*`).

## Idempotency

Storage derives a stable `edgeId` from endpoints, edge label kind, and merge id-parts. Re-running merge for the same focal key, neighbor key, and `retrieval_autolink` kind **updates** the existing edge row (see Convex `insertEdgeImpl`). Safe to re-run autolink as long as props remain JSON-serializable.

## Optional one-shot integrate

`integrateNewMemoryIntoGraph(client, args)` runs `client.search`, builds the patch, then `client.mergeMemory` with concatenated labels/edges. Requires a client whose ontology already includes the retrieval kinds.
