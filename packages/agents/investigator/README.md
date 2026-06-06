# @khoralabs/memories-investigator

Memory **investigator** agent: hybrid `memory_search` over one or many namespaces, then a structured **answer** (with optional citations). Same identity and tool-loop patterns as [`@khoralabs/memories-integrator`](../integrator).

## Namespaces

- **Primary** `namespace` is the subtree root passed to `MemoriesClient.search`.
- Optional **`additionalNamespaces`** (constructor and/or `investigate({ overrides })`) are forwarded as `SearchParams.additionalNamespaces` for every `memory_search` in the session.

## Domain tools

Pass **`extraToolMembers`** in `DefineMemoryInvestigatorIdentityOptions` when calling `defineMemoryInvestigatorIdentity` / `MemoryInvestigatorClient` options. They are composed with `memory_search` via `toolkit([memorySearchToolkit, ...], { name: "memory-investigator-toolkit" })` from `@khoralabs/agent-capabilities`.

Extra tools share the same session env as `memory_search`. Use **`memorySearchExtensions`** on the session context (and `MemorySearchEnv.memorySearchExtensions`) for host-owned state your domain tools read.

## Registry agent id

`buildMemoryInvestigatorAgentId` hashes the sorted union of primary + additional namespace paths and the static hashes of any `extraToolMembers`, so different scopes or tool sets register as distinct agents.

## Example

```ts
import { createAgentRegistry } from "@khoralabs/agent-capabilities";
import { MemoryInvestigatorClient } from "@khoralabs/memories-investigator";

const registry = createAgentRegistry();
const inv = new MemoryInvestigatorClient({
  registry,
  namespace: "app/user-1",
  additionalNamespaces: ["app/shared"],
  model,
  client,
  embeddingModel,
  instructions: ["Prefer calendar-shaped memories when dates matter."],
});

const { answer } = await inv.investigate({
  question: "What commitments mention Project X?",
  maxSteps: 12,
});
```
