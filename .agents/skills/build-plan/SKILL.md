---
name: build-plan
description: Explore the codebase and produce a structured implementation plan. No code written until you explicitly approve.
argument-hint: "[task to plan] (e.g., 'add OAuth login to mfe-settings')"
allowed-tools: Read Glob Grep Bash(ls *) Bash(cat *) Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git blame *) Bash(bundle exec *) Bash(bin/rails routes *) WebFetch WebSearch AskUserQuestion ExitPlanMode EnterPlanMode
---

# Plan

Explore the codebase and produce a structured implementation plan. No code written until you explicitly approve.

## Arguments

$ARGUMENTS — The task to plan (e.g., "add OAuth login to mfe-settings", "implement PDF export for financial reports", "add Stimulus controller for dynamic table filtering")

## Rules

**NEVER** use Write, Edit, MultiEdit, or NotebookEdit. No Bash command that writes to, moves, copies, or deletes files.

Read-only tools only: Read, Glob, Grep, Bash (read-only commands like `ls`, `cat`, `git log`, `git diff`, `git show`, `git blame`, `bin/rails routes`, `bundle exec`), WebFetch, WebSearch.

**MODE: READ-ONLY PLANNING.** If you notice code that could be improved, do not improve it. If you find a bug, do not fix it. Surface everything as findings or plan items only.

## Steps

### 1. Understand

Restate the goal in 1-2 sentences. If anything is ambiguous, use AskUserQuestion to resolve critical unknowns **before** exploring or drafting — do not make assumptions or defer them to "open questions."

### 2. Explore

Before drafting anything, read the relevant code:

- Use Glob and Grep to locate affected files
- Read existing patterns, conventions, and types in those areas
- Read any `CLAUDE.md` or `AGENTS.md` in the relevant directory before starting
- Check `config/routes.rb` to understand routing for the area being investigated
- Check for related specs in `spec/`
- Cross-reference config files (`Gemfile`, `config/importmap.rb`, `config/database.yml`, `config/routes.rb`) when architecture is involved
- Check Stimulus controllers in `app/javascript/controllers/` when investigating frontend behavior
- Check view partials and layouts in `app/views/` for rendering chains
- Look at model concerns in `app/models/concerns/` and controller concerns in `app/controllers/concerns/`

**Timebox exploration**: if you've read 10+ files without a clear picture, stop and surface open questions rather than keep digging.

### 3. Draft the Plan

Before writing anything, apply these rules:

- **ALWAYS model existing patterns** — find a real example in the codebase before proposing any new file structure, component shape, or API design
- **NEVER introduce a new pattern when an existing one covers the need** — if a pattern already exists, use it; explicitly justify any deviation
- **Cite the pattern** — for each proposed approach, name a specific file that demonstrates it (e.g., "following the pattern in `app/controllers/financial/commitments_controller.rb`")
- **ALWAYS follow framework and language best practices** — apply idiomatic conventions for the relevant stack (e.g., Rails: prefer concerns over duplication, use strong parameters, RESTful controller actions, scoped queries; Ruby: prefer explicit method signatures, use guard clauses, follow existing naming conventions; Stimulus: follow the existing controller registration pattern, use targets and values correctly)

Structure the plan as:

**Goal**: One sentence.

**Approach**: Why this approach, and what alternatives were considered (2-4 sentences).

**Files to change**:

| # | File | Change | Reason |
|---|------|--------|--------|
| 1 | `path/to/file.rb` | Description of what changes | Reason this file is affected |

**Files to create**:

| # | File | Purpose |
|---|------|---------|
| 1 | `path/to/new_file.rb` | What this file will do |

**Tests**:

| # | File | What to test |
|---|------|-------------|
| 1 | `spec/path/to/file_spec.rb` | Description of test coverage |

**Out of scope**: At least 2 things this plan explicitly does not cover.

**Rollback / cleanup**: How to undo this change if something goes wrong (especially relevant for schema changes, feature flags, shared dependencies, or data migrations).

**Open questions**: Anything uncertain that couldn't be resolved before planning and must be answered during implementation.

### 4. Enter Plan Mode

Call EnterPlanMode. End with: _"Let me know if you'd like to adjust anything — or run `/polish` for a structured review before approving."_

Do NOT write, edit, or create any files until the plan is approved.