# @khoralabs/memories-agents

Memory agents built on `@khoralabs/memories-node` and [`@khoralabs/agent-capabilities`](https://github.com/khoralabs/agent-capabilities). There is no package root export — import the surface you need.

## Entrypoints

| Export | Role | AI SDK? |
|--------|------|---------|
| `./tools` | `memorySearchToolkit`, session helpers, framework-free `MemorySearchAgentExecutor` type, embedding re-exports | No |
| `./adapter` | Zod expanded-memory wire, identity, instructions, message builders | No |
| `./integrator` | Zod plan wire, identity, instructions, merge-slice helpers | No |
| `./integrator/wire` | Durable integrate-memory event wire + write-scope policy | No |
| `./investigator` | Zod answer wire, identity, instructions, message builders | No |
| `./ai-sdk` | ToolLoop clients/sessions, `Output` wrappers, `toolLoopMemorySearchExecutor`, AI-shaped specs | **Yes** (optional peers) |

Layout mirrors [`memories-node` persistence](../node/src/persistence/IMPLEMENTORS.md): core contracts on the first entrypoints; optional runtime adapter on `./ai-sdk`.

**Optional peers** (install when importing `./ai-sdk`): `ai` ^7, `@khoralabs/agent-capabilities-ai-sdk` ^0.2.

`./ai-sdk` host-facing `model` / `chatModel` args are **`string` model IDs** (serializable). Pass a gateway/provider id such as `"openai/gpt-5"` — do not put AI SDK Gateway class instances in durable Workflow step args; resolve provider models inside the host step when you need an instance.

## Migration (0.10)

| Was | Now |
|-----|-----|
| `model: LanguageModel` / `chatModel: LanguageModel` on `./ai-sdk` clients, specs, sessions | `model: string` / `chatModel: string` |

## Migration (0.8)

| Was | Now |
|-----|-----|
| `MemoryAdapterClient` from `./adapter` | `@khoralabs/memories-agents/ai-sdk` |
| `MemoryIntegratorClient` / `processLogicalMemoryWithIntegrator` from `./integrator` | `./ai-sdk` |
| `MemoryInvestigatorClient` from `./investigator` | `./ai-sdk` |
| `toolLoopMemorySearchExecutor`, `buildMemorySearchAgentSpec`, `createMemorySearchToolLoopAgent*` from `./tools` | `./ai-sdk` |
| `memoryAdapterExpandedOutput`, `investigatorAnswerOutput`, `integratorPlanOutputFromOntology` | `./ai-sdk` |
| Zod schemas / `parse*` / identities / instructions / wire | unchanged on core entrypoints |

## Tools (core)

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

## Agents (AI SDK)

```ts
import {
  MemoryInvestigatorClient,
  MemoryIntegratorClient,
  MemoryAdapterClient,
} from "@khoralabs/memories-agents/ai-sdk";

const investigator = new MemoryInvestigatorClient({
  registry,
  namespace: "app/user-1",
  model: "openai/gpt-5", // string model id (serializable)
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

Built-in AI SDK clients default to `ToolLoopAgent` via `toolLoopMemorySearchExecutor` from `./ai-sdk`. For durable, resumable loops ([WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent)), build a spec and supply a custom executor — this package does not depend on `@ai-sdk/workflow`.

```ts
import { WorkflowAgent, isStepCount } from "@ai-sdk/workflow"; // host dependency
import { getWritable } from "workflow";
import {
  buildMemoryInvestigatorAgentSpec,
  type MemorySearchAgentSpec,
} from "@khoralabs/memories-agents/ai-sdk";
import type { MemorySearchAgentExecutor } from "@khoralabs/memories-agents/tools";

const workflowExecutor: MemorySearchAgentExecutor = {
  async run(spec, { messages, abortSignal }) {
    const s = spec as MemorySearchAgentSpec;
    const agent = new WorkflowAgent({
      id: s.id,
      model: s.model,
      tools: s.tools,
      instructions: s.instructions,
      prepareStep: s.prepareStep,
    });
    const result = await agent.stream({
      messages,
      output: s.output,
      stopWhen: isStepCount(s.maxSteps),
      writable: getWritable(),
      abortSignal,
    });
    return {
      output: result.output,
      messages: result.messages,
    };
  },
};
```

Use `buildMemoryInvestigatorAgentSpec` (or adapter/integrator equivalents) from `./ai-sdk` when constructing the AI-shaped spec for the session.
Lower-level wiring:

- `./tools` — `MemorySearchAgentExecutor`, toolkit + session context helpers
- `./ai-sdk` — `buildMemory*AgentSpec`, `toolLoopMemorySearchExecutor`, clients
- `./integrator` — `mergeSearchPhaseMessages` moved to `./ai-sdk`

**Serialization constraint:** `MemorySearchEnv` holds non-serializable handles (`memoriesClient`, `Map`/`Set` caches, live tool closures). Durable workflow steps that mark tool `execute` with durable step directives must rehydrate clients from serializable `toolsContext` / `runtimeContext`, or run tools without step durability (durable agent loop, in-memory tool calls). That rehydration is host responsibility — not provided here. Keep `model` as a string id in serializable step args; resolve provider/`LanguageModel` instances inside the host step if required.
