# @khoralabs/memories-agents

Memory agents built on `@khoralabs/memories-node` and [`@khoralabs/agent-capabilities`](https://github.com/khoralabs/agent-capabilities). There is no package root export — import the agent you need.

## Entrypoints

| Export | Role |
|--------|------|
| `./tools` | `memorySearchToolkit`, session helpers, telemetry, embedding re-exports |
| `./adapter` | `MemoryAdapterClient` — domain payload → ontology-aware memory draft |
| `./integrator` | `MemoryIntegratorClient` — decompose, embed, merge logical memories |
| `./integrator/wire` | Durable integrate-memory event wire + write-scope policy |
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

## Custom runners (WorkflowAgent)

Built-in clients and session runners default to AI SDK `ToolLoopAgent` via `toolLoopMemorySearchExecutor`. For durable, resumable loops ([WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent)), build a spec and supply a custom executor — this package does not depend on `@ai-sdk/workflow`.

```ts
import { WorkflowAgent, isStepCount } from "@ai-sdk/workflow"; // host dependency
import { getWritable } from "workflow";
import { buildMemoryInvestigatorAgentSpec } from "@khoralabs/memories-agents/investigator";
import type { MemorySearchAgentExecutor } from "@khoralabs/memories-agents/tools";

const workflowExecutor: MemorySearchAgentExecutor = {
  async run(spec, { messages, abortSignal }) {
    const agent = new WorkflowAgent({
      id: spec.id,
      model: spec.model,
      tools: spec.tools,
      instructions: spec.instructions,
      prepareStep: spec.prepareStep,
    });
    const result = await agent.stream({
      messages,
      output: spec.output,
      stopWhen: isStepCount(spec.maxSteps),
      writable: getWritable(),
      abortSignal,
    });
    return {
      output: result.output,
      messages: result.messages,
    };
  },
};

// Pass via registry session ctx (ToolLoop remains the default when omitted)
registry.createSession(agentId, {
  ctx: {
    model,
    client,
    embeddingModel,
    namespace,
    executor: workflowExecutor,
  },
});
```

Lower-level wiring without clients:

- `./tools` — `buildMemorySearchAgentSpec`, `MemorySearchAgentExecutor`, `toolLoopMemorySearchExecutor`
- `./investigator` — `buildMemoryInvestigatorAgentSpec` (same pattern on `./adapter` and `./integrator`)
- `./integrator` — `mergeSearchPhaseMessages` for the plan phase after search

**Serialization constraint:** `MemorySearchEnv` holds non-serializable handles (`memoriesClient`, `Map`/`Set` caches, live tool closures). Durable workflow steps that mark tool `execute` with `'use step'` must rehydrate clients from serializable `toolsContext` / `runtimeContext`, or run tools without step durability (durable agent loop, in-memory tool calls). That rehydration is host responsibility — not provided here.
