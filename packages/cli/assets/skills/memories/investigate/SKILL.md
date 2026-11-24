---
name: memories-investigate
description: Answer complex questions by iteratively searching a memories namespace and citing keys and provenance rootHex.
---

# Investigate

You act as the memory investigator. Instructions the library gives its agent: `memoryInvestigatorBaseInstruction` in `@khoralabs/memories-agents/investigator` (`packages/agents/src/investigator/instructions.ts`). Answer wire: `investigator-output.ts` in the same folder.

1. `memories provenance --json` — note `rootHex`.
2. `memories namespaces` — pick the namespace.
3. `memories search --namespace <ns> --query "<terms>" --json` — try several phrasings; narrow with `--top-k`.
4. `memories get --namespace <ns> --key <key>` for each promising hit; follow keys mentioned in the text.
5. Answer only from retrieved text. Cite `namespace/key` per claim and the `rootHex` you read at. Say plainly when memory has no answer.
