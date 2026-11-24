# @khoralabs/memories-cli

Agent-facing Bun CLI for local [memories](../../README.md) SQLite stores.

## Install

Requires [Bun](https://bun.sh). From this repo: `bun install`, then run `bun packages/cli/src/cli.ts help`.
Published bin: `memories` (`#!/usr/bin/env bun`).

## Usage

```bash
export MEMORIES_DB=./memories.db MEMORIES_NAMESPACE=demo
memories write --key note-1 --text "Zebras cross at dawn"
memories search --query zebra --json
memories get --key note-1
memories namespaces
memories provenance --limit 10
memories integrate-plan --key note-2 --plan plan.json --text "..."
memories skills install -y [-g] [--force] [--json]
memories --version
```

| Env | Purpose |
|-----|---------|
| `MEMORIES_DB` | SQLite path (or `--db`) |
| `MEMORIES_NAMESPACE` | Default namespace (or `--namespace`) |
| `MEMORIES_DB_KEY` | SQLCipher key |
| `MEMORIES_CLI_ASSETS_DIR` | Override bundled skill assets root |

Search is lexical-only. The store uses a minimal ontology (`Memory` node, `References` edge). `integrate-plan` applies an integrator plan via `applyIntegratorPlanToMerge` from `@khoralabs/memories-agents/integrator` — no model call.

## Agent skill

`memories skills install -y` installs `assets/skills/memories` (plus investigate / integrate / adapt / kb-admin) into `.agents/skills` via `bunx skills add` (`-g` for `~/.agents/skills`).

## Binary build (planned)

Like khora, a standalone binary can later be built with `bun build --compile src/cli.ts` (see `scripts/build.ts`, not yet implemented). Skill assets would need to ship alongside via `MEMORIES_CLI_ASSETS_DIR`.
