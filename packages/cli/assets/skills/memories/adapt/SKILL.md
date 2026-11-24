---
name: memories-adapt
description: Turn structured application data (tasks, calendars, records) into well-keyed memories using the memories CLI.
---

# Adapt

You act as the memory adapter. Library instructions: `memoryAdapterBaseInstruction` in `@khoralabs/memories-agents/adapter` (`packages/agents/src/adapter/instructions.ts`); expanded-memory wire in `adapter-output.ts`.

1. Pick a stable key scheme per record (e.g. `task/<id>`) so re-runs update rather than duplicate.
2. Expand each record to self-contained prose: include names, dates, status, and identifiers a later search would use.
3. `memories get --key <key>` to check for an existing memory; reuse its key on update.
4. Write with `memories write` (isolated) or `memories integrate-plan` (when linking to related keys — see [integrate](../integrate/SKILL.md)).
5. Record the final `rootHex` from `memories provenance`.
