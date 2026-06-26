---
name: plan-critique
description: Structured devil's advocate review of an implementation plan. Surfaces gaps, risks, and missing pieces — then applies amendments directly. Append "dry-run" to only report.
allowed-tools: Read Glob Grep Edit Write Bash(ls *) Bash(cat *) Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git blame *) Bash(bundle exec *) Bash(bin/rails routes *) WebFetch WebSearch AskUserQuestion TaskGet TaskUpdate
---

# Plan Critique

Review the current implementation plan as a structured devil's advocate. Surface gaps, risks, and missing pieces — then apply amendments directly to the plan.

## Arguments

$ARGUMENTS — Append `dry-run` to only report without applying changes (e.g., "dry-run"). If empty, defaults to critique-and-fix mode.

## Rules

- **Default mode: critique and fix.** After reporting issues, apply all critical amendments and suggestions directly to the plan.
- **`dry-run` mode**: If $ARGUMENTS contains `dry-run`, report all issues but do NOT modify the plan.
- **Preserve plan intent.** Fix gaps, risks, and missing pieces — do not change the overall goal or approach unless it's fundamentally flawed.
- **Surgical amendments only.** Add missing steps, fix incorrect assumptions, strengthen weak areas — do not rewrite the entire plan.

## Steps

Work through each of these lenses systematically. For each, actively search the codebase to verify — don't rely on what's already been stated in the plan.

### 1. Completeness

- Are all affected files listed? Search for related imports and usages of anything being changed.
- Are there files that will break if the listed changes are made but aren't included in the plan?
- Is there a test plan? Are the right test files identified?
- Are database migrations accounted for if schema changes are involved?
- Are route changes reflected in `config/routes.rb`?

### 2. Correctness of Approach

- Are there simpler alternatives that weren't considered?
- Does the approach follow established patterns and conventions in this codebase?
- Does this approach introduce technical debt or cut against existing conventions?
- Is the proposed file/class/method naming consistent with the rest of the codebase?
- Are the right Rails/Ruby/Stimulus idioms being used?

### 3. Risks & Edge Cases

- What could go wrong during implementation?
- Are there null states, error paths, loading states, or race conditions unaccounted for?
- Are there shared dependency or singleton concerns?
- Could this break existing functionality in other areas?
- Are there authorization/permission checks that need updating?
- Are there performance implications (N+1 queries, large data sets, missing indexes)?

### 4. Assumptions

- What does the plan assume to be true? List them explicitly.
- Which assumptions are most likely to be wrong or worth verifying first?
- Are there implicit dependencies on external services, gems, or configurations?

### 5. Scope

- Is the plan doing too much? Could it be split into safer, smaller steps?
- Is it doing too little — will the result be incomplete or require immediate follow-up?
- Are there related changes that should be bundled together to avoid a broken intermediate state?

## Output Format

**Verdict**: Ready to approve / Needs revision

**Critical issues** _(must resolve before implementing)_:
- ...

**Suggestions** _(nice-to-have improvements)_:
- ...

**Looks solid**:
- ...

### After reporting (default mode — not dry-run):

Apply all critical issues and suggestions directly to the plan using TaskUpdate or Edit. Amend the plan in place — add missing steps, fix incorrect file references, add edge case handling, strengthen test coverage, etc. Then summarize:

**Amendments applied**:
1. What was changed and why
2. ...

### After reporting (dry-run mode):

Do not modify the plan. End with the report above — the user decides next steps.