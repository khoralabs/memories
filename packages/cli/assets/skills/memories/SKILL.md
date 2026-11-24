---
name: memories
description: Search, read, write, and audit a local memories (knowledge-graph) store with the `memories` CLI. Use when the user asks you to look up, record, or integrate durable memory, or to investigate/administer a memories SQLite database.
---

# memories

Operate a local memories SQLite store through the `memories` CLI. Every command needs `--db <path>` (or `MEMORIES_DB`); namespaced commands need `--namespace <ns>` (or `MEMORIES_NAMESPACE`). Add `--json` for machine output.

## CLI map

| Command | Use |
|---------|-----|
| `memories search --query "..." [--top-k N]` | Lexical search in a namespace |
| `memories get --key <key>` | Read a memory's stored text |
| `memories namespaces` | List namespaces (with descriptions) |
| `memories provenance [--limit N]` | Head `rootHex` + recent provenance chain |
| `memories write --key <key> --text "..."` | Write plain text memory (label `Memory`, no edges) |
| `memories integrate-plan --key <key> --plan plan.json [--text "..."]` | Apply a structured integrator plan |

## Role routing

| Task | Sub-skill |
|------|-----------|
| Answer a question from memory | [investigate](investigate/SKILL.md) |
| Store new content with labels/edges | [integrate](integrate/SKILL.md) |
| Map structured app data into memories | [adapt](adapt/SKILL.md) |
| Inspect, audit, or tidy a store | [kb-admin](kb-admin/SKILL.md) |

## Audit

Run `memories provenance --json` before and after reading or writing. Cite `rootHex` with any claim so it can be checked against the store state at that tip; a changed `rootHex` means the store moved.

The CLI is lexical-only and uses a minimal ontology (`Memory` node, `References` edge). Never invent keys: confirm with `search`/`get` first.
