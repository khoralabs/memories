# @khoralabs/memories-node

Individual memory node: typed client, persistence contracts, storage backends, ontology families, graph projections, contributor attestation, and autolink.

This is the embeddable core. For multi-tenant HTTP, see [`@khoralabs/memories-service`](../service). For agent loops, see [`@khoralabs/memories-agents`](../agents).

## Entrypoints

| Export | Contents |
|--------|----------|
| `.` | `MemoriesClient` / async, merge/search/delete, IDs, graph helpers (re-exports persistence contracts) |
| `./persistence` | `MemoriesPersistence` types, row Zod schemas, capabilities |
| `./provenance` | Hash chain + content-hash helpers |
| `./helpers` | Embeddings, logical-memory decomposition, hybrid search pipeline |
| `./telemetry` | `MemoriesTelemetry` sink types + emit helpers (no OTel deps; use `@khoralabs/memories-otel` to adapt) |
| `./ontology` | Barrel: families, `defineOntology`, `mergeOntologies`, label-props formatters |
| `./ontology/core` | `defineOntology` only |
| `./ontology/merge-ontologies` | `mergeOntologies` |
| `./ontology/families/*` | `entities`, `knowledge`, `poleo`, `preferences`, `relations`, `retrieval`, `salience`, `temporal` |
| `./sqlite` | SQLite persistence + projections (**Bun** — `bun:sqlite`) |
| `./libsql` | LibSQL persistence + projections; Node-safe |
| `./turso-serverless` | Turso Cloud persistence; Node-safe (no projection helpers yet) |
| `./projections` | UMAP / namespace graph layout math (**requires `umap-js`**) |
| `./projections/projection-input` | Wire codec only (no `umap-js`) |
| `./attestation` | Contributor attestation envelope + formats |
| `./attestation/formats/direct-principal-v1` | Caller-signed principal attestation |
| `./attestation/formats/http-request-v1` | Server-signed HTTP request attestation |
| `./autolink` | `runAutolinkIntegrate` |
| `./autolink/workflows` | Workflow DevKit wrappers (**requires `workflow`**) |
| `./testing` | Persistence + projections conformance runners |

Backend drivers are optional peer dependencies — see the [root README](../../README.md) install matrix.

**Runtime:** `./sqlite` requires [Bun](https://bun.sh). Use `./libsql` or `./turso-serverless` on Node. Hosts that only ship projection input payloads should import `./projections/projection-input`, not the full `./projections` barrel.

## Ontology

Compose label maps from families:

```ts
import { defineOntology } from "@khoralabs/memories-node/ontology/core";
import { poleoOntology } from "@khoralabs/memories-node/ontology/families/poleo";
import { mergeOntologies } from "@khoralabs/memories-node/ontology/merge-ontologies";
import { salienceRetrievalMemoryOntology } from "@khoralabs/memories-node/ontology/families/salience";

const ontology = mergeOntologies(poleoOntology, salienceRetrievalMemoryOntology);
```

## Persistence

Operational contract (ordering, capabilities, projections): [`src/persistence/IMPLEMENTORS.md`](src/persistence/IMPLEMENTORS.md).

Smithy capability modules: [`@khoralabs/memories-spec`](../spec).

```ts
import {
  createMemoriesPersistence,
  openMemoriesDatabase,
} from "@khoralabs/memories-node/sqlite";

// Plaintext (omit sqlCipherKey). Pass sqlCipherKey to enable SQLCipher.
const db = openMemoriesDatabase(":memory:");
const persistence = createMemoriesPersistence(db);
```

Async factories: `createMemoriesPersistenceAsync` (sqlite), `createMemoriesLibsqlPersistence`, `createMemoriesTursoServerlessPersistence`.

## Telemetry

Node emits typed structured events for **merge**, **delete**, and **search** when you pass a `MemoriesTelemetry` sink. The core package has **no** OpenTelemetry dependency — use [`@khoralabs/memories-otel`](../otel) to map events to spans/metrics/Pino (bring your own Tracer/Meter/Logger; the adapter does not start an SDK).

```ts
import { MemoriesClient } from "@khoralabs/memories-node";
import { createMemoriesOtelTelemetry } from "@khoralabs/memories-otel";
import { trace } from "@opentelemetry/api";

const telemetry = createMemoriesOtelTelemetry({
  tracer: trace.getTracer("my-app"),
});

const client = new MemoriesClient(persistence, ontology, { telemetry });
// mergeMemory / deleteMemory / search emit memories.op.* when telemetry is set
```

You can also pass `telemetry` on a mutation context when calling `mergeMemory` / `search` / `deleteMemory` directly:

```ts
import { mergeMemory } from "@khoralabs/memories-node";

mergeMemory({ persistence, telemetry }, params);
```

Helpers: `noopMemoriesTelemetry`, `bindMemoriesTelemetry` (stamp static attrs onto every emit) from `@khoralabs/memories-node/telemetry`. Span names and attribute catalog: [`../otel/README.md`](../otel/README.md).

## Bun + Next

`./sqlite` uses `bun:sqlite` and optionally `sqlite-vec`. Those stay behind that subpath — do not import them via the package root.

When embedding under **Bun + Next.js**, put natives outside the bundler island:

```js
// next.config.js
const nextConfig = {
  serverExternalPackages: [
    "@khoralabs/memories-node",
    "@khoralabs/memories-service",
    "@khoralabs/memories-otel",
  ],
};
```

Why: Next’s server graph otherwise tries to analyze/bundle `bun:sqlite`, optional `sqlite-vec`, and `createRequire`-style loaders. Externalizing keeps them as runtime `require`s under Bun.

With Bun’s isolated installs, Next may resolve externals into a hashed island that does not see transitive deps. If you hit missing modules at runtime, declare those peers as **direct** dependencies of the Next app (same pattern as relay/`zod` for vellum hosts).

## Attestation and autolink

- **Attestation** — signed contributor envelopes stored on provenance events (`khora.direct-principal-v1`, `khora.http-request-v1`). Used by the service HTTP attribution path.
- **Autolink** — search for related nodes, plan link patches, merge edge memories. Optional durable workflows under `./autolink/workflows`.

## Further reading

- System mental model, schema, search: [`../README.md`](../README.md)
- Root overview: [`../../README.md`](../../README.md)
