---
name: memories-kb-admin
description: Inspect and audit a memories store: namespaces, provenance chain, and spot-check reads. Read-mostly.
---

# KB admin

1. `memories namespaces --json` — inventory namespaces and descriptions.
2. `memories provenance --limit 50 --json` — head `rootHex` and recent events (`eventType`); confirm the chain is advancing as expected.
3. Spot-check: `memories search` a few known topics per namespace, then `memories get` the hits.
4. Report findings with `rootHex`. Make changes only when asked, using `memories write` / `integrate-plan`; re-run `provenance` afterwards.

The CLI has no delete or rename. For those use the `@khoralabs/memories-node` API (`deleteMemory`, namespace ops) from code.
