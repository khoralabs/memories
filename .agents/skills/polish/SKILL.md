---
name: polish
description: Review all current changes for quality, correctness, and consistency before committing or raising a PR. Find and fix issues directly.
allowed-tools: Read Glob Grep Edit Write Bash(git *) Bash(npm run *) Bash(npx *) Bash(ls *)
---

# Polish Changes

Review all current changes for quality, correctness, and consistency before committing or raising a PR. Find and fix issues directly in the files, then produce a summary.

## Context

You are a senior engineer performing a final polish pass on in-progress work. Your goal is to catch problems that are easy to miss mid-flow: dead code, style inconsistencies, anti-patterns, and violations of codebase conventions.

Be surgical — fix what's wrong, leave what's right. Only touch code within the current diff; do not refactor unrelated files you happen to read.

Before starting, check for a `CLAUDE.md` or `AGENTS.md` in the current project directory and read it. Follow any project-specific conventions it defines.

## Process

### 1. Understand the Diff

```bash
git diff HEAD
git status
```

- All unstaged + staged changes
- New files not yet tracked

If the diff is empty and there are no untracked files, state that the working tree is clean and stop.

Read every changed and new file in full. Understand the intent before judging the implementation.

### 2. Run Verification (baseline)

Run the project's lint and type check commands before making any edits so you know which failures pre-exist vs. which you introduce:

```bash
npm run lint
npm run type-check
```

Note any pre-existing failures. Failures introduced by this pass must be resolved before it is complete. Pre-existing failures should be surfaced in the **Flagged** section — do not attempt to fix them.

### 3. TypeScript & React Hygiene

Check each changed file for:

- **Unused variables / imports** — remove any import or variable that is unused
- **Dead code** — remove commented-out code, `console.log`/`debugger` statements; move any TODO comments to the Flagged section with a note on what they're blocking
- **TypeScript strictness** — no `any` types, no `@ts-ignore` without justification; prefer `Doc<"tableName">` from `@bloom-us/backend/dataModel` over custom types
- **Convex patterns** — use `useSessionQuery`/`useSessionMutation` from `convex-helpers/react/sessions` for authenticated queries, not raw `useQuery`/`useMutation`
- **API imports** — use `api` from `@bloom-us/backend`, not `@/convex/_generated/api`

### 4. Component & UI Hygiene

Check changed React component files for:

- **Server/Client boundary** — `"use client"` only where necessary; push client boundaries down the tree
- **Tailwind consistency** — follow existing patterns in the codebase; no inline styles when Tailwind classes exist
- **shadcn/ui usage** — use existing UI primitives from `_shared/components/ui/` instead of raw HTML elements
- **Component extraction** — if a component block is duplicated across files in the diff, extract per the Rule of Two
- **Scoping** — components placed at the narrowest scope; `_` prefix for non-route folders inside `app/`
- **Accessibility** — proper ARIA attributes, keyboard navigation, focus management

### 5. Test Hygiene

Check changed test files for:

- **Missing tests** — new Convex functions or significant logic should have corresponding Vitest tests in `packages/backend/`
- **Deterministic tests** — no reliance on ordering without explicit sorting; no time-dependent tests without mocking

### 6. Codebase Pattern Compliance

Check against patterns already established in this repo (see `AGENTS.md`):

- **Folder structure** — follows scope-based placement: `_shared/` for global, `app/(group)/` for route group, `app/(group)/route/` for page-specific
- **Convex types** — prefer `Doc<"table">` over custom type definitions
- **Hook patterns** — custom hooks co-located with their usage or in `_shared/hooks/`
- **Data fetching** — Server Components use `fetchQuery` from `convex/nextjs`; Client Components use `useSessionQuery`

### 7. Security Quick-Check

- **No secrets in code** — no hardcoded API keys, tokens, or credentials
- **Authorization** — Convex mutations should validate session/user permissions
- **Input validation** — user inputs should be validated with Zod schemas
- **XSS prevention** — no `dangerouslySetInnerHTML` without sanitization

### 8. Summary

After all fixes are applied, produce:

**Changes made**: A numbered list of every edit, with file path and one-line description.

**Flagged** (do not fix): Pre-existing issues, TODOs found in diff, or problems outside the scope of current changes.

**Verification result**: Output of lint/test/security commands after your edits — confirm no new failures were introduced.
