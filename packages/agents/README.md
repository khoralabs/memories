# @khoralabs/memories-agents

Memory agents built on `@khoralabs/memories-node` and [`@khoralabs/agent-capabilities`](https://github.com/khoralabs/agent-capabilities). There is no package root export — import the agent you need.

## Entrypoints

| Export | Role |
|--------|------|
| `./tools` | `memorySearchToolkit`, session helpers, telemetry, embedding re-exports |
| `./adapter` | `MemoryAdapterClient` — domain payload → ontology-aware memory draft |
| `./integrator` | `MemoryIntegratorClient` — decompose, embed, merge logical memories |
| `./investigator` | `MemoryInvestigatorClient` — multi-step Q&A over namespaces |

## Tools

`memorySearchToolkit` is an `@khoralabs/agent-capabilities` toolkit. Session env (client, namespace, embeddings) is injected via context helpers — not constructor args:

```ts
import {
  memorySearchToolkit,
  buildMemorySearchToolkitContext,
} from "@khoralabs/memories-agents/tools";

const toolkitCtx = buildMemorySearchToolkitContext({
  client,
  namespace: "app/user-1",
  embeddingModel,
  additionalNamespaces: ["app/shared"],
});
// Compose memorySearchToolkit into a registry / tool loop with toolkitCtx
```

`memory_search` runs hybrid lexical + vector search (via node helpers) and can attach a provenance `root_hex` snapshot for cited answers.

## Agents

```ts
import { MemoryInvestigatorClient } from "@khoralabs/memories-agents/investigator";
import { MemoryIntegratorClient } from "@khoralabs/memories-agents/integrator";
import { MemoryAdapterClient } from "@khoralabs/memories-agents/adapter";

const investigator = new MemoryInvestigatorClient({
  registry,
  namespace: "app/user-1",
  model,
  client,
  embeddingModel,
});

const { answer } = await investigator.investigate({
  question: "What commitments mention Project X?",
  maxSteps: 12,
});
```

Typical pipeline: **adapter** (raw domain → draft) → **integrator** (draft → merged graph memories) → **investigator** / **tools** (read path). Graph connectivity after integrate can use `@khoralabs/memories-node/autolink`.

Wire sessions with `createAgentRegistry` and tool loops from `@khoralabs/agent-capabilities`. See the [root README](../../README.md) for composition context and [`../README.md`](../README.md) for the search pipeline these agents call.
