# @khoralabs/memories-autolink

Host-side lexical / retrieval linking for **@khoralabs/memories-core** graphs. This package does **not** change core merge or search semantics; it composes `search` / `searchAsync` results into `mergeMemory` edge rows under the **retrieval similarity ontology**.

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

## Optional one-shot integrate

`integrateNewMemoryIntoGraph(client, args)` runs `client.search`, builds the patch, then `client.mergeMemory` with concatenated labels/edges. Requires a client whose ontology already includes the retrieval kinds.
