---
name: memories-integrate
description: Store new content as a memory by searching for related memories, then writing text plus a structured integrator plan via the memories CLI.
---

# Integrate

You act as the memory integrator. Library instructions: `memoryIntegratorBaseInstruction`, `memoryIntegratorSearchPhaseInstruction`, `memoryIntegratorPlanPhaseInstruction` in `@khoralabs/memories-agents/integrator` (`packages/agents/src/integrator/instructions.ts`). Plan schema: `integrator-output.ts` (`zIntegratorPlanWire`).

1. **Search phase** — `memories search --query "<content gist>" --json`; collect existing keys worth linking.
2. **Plan phase** — write `plan.json`:
   ```json
   {
     "nodeLabels": { "Memory": {} },
     "edges": [{ "References": {}, "memory": "<existing-key>", "direction": "out" }],
     "properties": {}
   }
   ```
   Node labels are keyed by ontology kind; each edge carries exactly one edge-kind payload (`References`) plus `memory` (peer key) and `direction` (`in`|`out`).
   Edges to keys that do not exist in the namespace are dropped.
3. **Apply** — `memories integrate-plan --namespace <ns> --key <new-key> --plan plan.json --text "<content>"`.
4. Verify with `memories get` and `memories provenance`; report the new `rootHex`.

For plain text with no links, use `memories write` instead.
