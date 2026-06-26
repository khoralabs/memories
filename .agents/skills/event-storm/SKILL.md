---
name: eventstorm-feature
description: Collaboratively event-storm a feature with the user — discover domain context, capture decisions, and produce a living event-storm document in docs/. No code written.
argument-hint: "[feature or issue to event-storm] (e.g., 'Allow Ops to add Project and Need on behalf of HB')"
allowed-tools: Read Glob Grep Write Edit Bash(ls *) Bash(cat *) Bash(find *) Bash(grep *) Bash(mkdir *) Bash(git log *) Bash(git diff *) Bash(git show *) Bash(git blame *) Bash(npm run *) Bash(npx *) WebFetch WebSearch AskUserQuestion
---

# Event Storm Feature

Work with the user to event-storm a feature request from a real product issue. Discover the domain anchors in the codebase, interactively pin down the actor/commands/events/policies, capture decisions, and produce a living event-storm document in `docs/` that evolves as the conversation continues.

**Scope boundary vs. `/build-plan`**: this skill stops at _"we understand the feature and have agreed on what to build"_. It does **not** produce a file-by-file implementation plan, tests, or code. Once the event storm stabilises, hand off to `/build-plan`.

## Arguments

$ARGUMENTS — The feature or issue to event-storm. Typically a short issue title (e.g., "Allow Ops to add Project and Need on behalf of HB"), a Linear/Jira reference, or a sentence describing the capability to be built.

## Rules

- **NEVER write code.** The only files this skill writes or edits are the event-storm markdown document in `docs/` and `.claude/skills/` artifacts if the user asks. If you notice a bug or a refactor, surface it as an `Incidental finding` — do not fix it.
- **NEVER make up domain decisions.** When the user has not answered a question, it stays **open** in the doc. Use `AskUserQuestion` or a direct prompt to pull answers out; do not pick an answer for them.
- **Anchor every claim to the code.** Names of entities, mutations, routes, and guards go in the doc **only** after grepping/reading the actual file. If a claim is a guess, label it `(to verify)`.
- **Terms come from the codebase, not from you.** If the user says "HB", confirm what it maps to by finding it in code (e.g., `startHardwareBrandWorkflow`). Do not invent acronyms or glossary entries.
- **The doc is living, not final.** Expect the user to change their mind. Use `Edit` to update decisions and the event-storm diagram in place. Closed questions move from §4 (Open) to §3 (Decisions) with the answer recorded; reopened questions move back.
- **Open questions stay visible.** If the user marks a question as "TBD" or "I don't know yet", keep it in §4 with its sub-points — do not delete it, do not silently close it.
- **Scope discipline.** Don't pull in adjacent features unless the user asks. List adjacent concerns as `Non-goals` in §8.
- **`TBD` vs `TODO`.** The literal word **`TBD`** is **allowed** in the doc when the user has explicitly deferred a decision. The word **`TODO`** is **banned** — it signals the skill cut corners. Same for `FIXME`, `XXX`, `???`. If you're tempted to write `TODO`, ask the user instead.
- **No chat/AI intake in the doc itself.** The document is plain markdown for humans — no embedded prompts, no template scaffolding, no trailing "fill this in later" sections.

## Steps

### 1. Understand the request

Restate the feature/issue in one sentence. If the title contains unfamiliar domain terms (acronyms, role names, artifact names), note them — they go to Step 2 for grounding.

If $ARGUMENTS is empty or truly ambiguous, use `AskUserQuestion` to ask what feature to event-storm before proceeding. Do not guess.

**Scope-size check.** Before exploring, sanity-check the size. If the title implies an unbounded effort ("redesign onboarding", "rework billing") rather than a bounded capability ("allow Ops to X", "add Y to Z flow"), ask the user to narrow it to a single bounded feature first — event storming a whole product area will be noisy and low-value. One bounded feature per skill invocation.

### 2. Discover the domain anchors (read-only exploration)

Ground every term in the request against actual code. The goal is a glossary where every row points to a specific file.

- **Entities**: check `docs/architecture/models.md` for the canonical domain model (Actor / Resource / Derived classification and entity purposes). This is the project's authoritative domain ontology.
- **Backend**: `packages/backend/convex/<domain>/_functions/*`, `_resolvers/*`, `_adapters/*`. Look for existing mutations, auth guards (`requireOpsEntitlement`, `getOptionalCompanyFromContext`, `withProjectAlterAccess`, etc.), and the shape of `args`.
- **Frontend routes**: `apps/platform/src/app/(session)/**`. Pay attention to:
  - `(session)/[company]/**` → per-company HB/Provider views
  - `(session)/ops/**` → Ops dashboards
  - `(session)/admin/**` → admin/network tools
  - `welcome/**` → onboarding flows (often chat-based)
- **Existing precedents**: search for "on behalf of" patterns — e.g., `_operations/network.ts`, `createMatchingNeedForProject` (an ops-gated write path that mirrors a user-facing one).
- **Side effects**: before saying "X already triggers a notification", grep for the actual notification path (`notifications.*type`, `scheduleNeedAssignmentSideEffects`, `processNeedAssignmentEvents`, etc.) and read it.
- **CLAUDE.md / AGENTS.md** in the relevant subtree — read first if present.

**Timebox**: if you've read ~10 files without a clear domain model forming, stop exploring and ask the user a clarifying question (Step 4) rather than keep digging.

### 3. Draft the event storm (first pass)

Produce a first-pass structured discovery. Do not write it to a file yet — present it in the chat so the user can react quickly. Structure it as:

- **Glossary** — every domain term mentioned in $ARGUMENTS or discovered in Step 2, with a file reference.
- **Current state** — what the system already does that's relevant, and what specifically blocks the requested feature today (e.g., "`project.create` throws `Unauthorized` for anyone whose demand profile doesn't match the owner").
- **Event storm** — using this notation: 🟧 Command · 🟨 Event · 🟥 Policy/Rule · 🟦 Read Model · 👤 Actor · ❓ Open question. Show the flow left-to-right (or top-to-bottom in a fenced code block) from the Actor's entry point through Commands → Policies → Events → Read Models.
- **Open questions** — numbered, with a one-line "why it matters" for each.

Keep the first pass **tight**. Do not pre-answer open questions.

### 4. Interactively resolve decisions

Present the open questions to the user. Use `AskUserQuestion` when the list is short and the answers are structured; use a plain prompt when the user prefers narrative back-and-forth.

For each answer:

- **Decision made** → move the row from §4 (Open) to §3 (Decisions) with the answer recorded. Update every place in the event-storm diagram that referenced the old `❓` marker.
- **"I don't know" / "TBD"** → keep the row in §4, and replace any specific sub-item the user wants deferred with the literal word **TBD**. Don't delete sub-items unless the user says so.
- **User changes their mind** → move the row back to §4; update the diagram and any dependent decisions.
- **Multiple stakeholders disagree** (e.g., two teammates answer differently) → flag the conflict honestly, summarize each side, and ask the user which to take — or record both under §4 as a tension to resolve.

### 5. Write / update the document

**File path**: `docs/<kebab-slug>-eventstorm.md`.

**Slug rule**: 2–5 kebab-cased words derived from the issue title. Strip stop words (`allow`, `the`, `of`, `for`, `on`, `a`, `to`). Prefer the Actor + Action + Object form. Example: "Allow Ops to add Project and Need on behalf of HB" → `ops-add-project-and-need`.

**If `docs/` doesn't exist**: create it with `mkdir -p docs/`. If the project has a different conventional location for specs (check for `specs/`, `design/`, or ask the user), put it there instead.

Document skeleton (use this structure — adjust headings only if the feature genuinely doesn't have the section):

1. **Title + status banner** — `Status: Discovery / event storm. Not an implementation plan yet.` + issue reference + glossary for load-bearing acronyms.
2. **§1 Glossary** — term → what it is → where in code.
3. **§2 Current state** — what exists today + what blocks the feature.
4. **§3 Decisions so far** — closed questions with their resolution. Include a `#` column that matches the original open-question number so renumbering never breaks cross-references.
5. **§4 Open questions** — still-unresolved ones with "why it matters".
6. **§5 Event storm** — the diagram(s), in fenced code blocks, with `❓` markers at exactly the steps each open question affects.
7. **§6 Aggregates + invariants** — which aggregates are touched, which invariants must hold.
8. **§7 What to build (shape, not story slicing)** — the surface area that's clear. Mark anything blocked on an open question as such.
9. **§8 Non-goals for this issue** — explicit exclusions.
10. **§9 Incidental findings** *(only if any)* — bugs, dead code, or out-of-scope improvements spotted during Step 2 discovery. File references only. Omit the section entirely if there are none.

Use `Write` for the first creation; use `Edit` for every subsequent change. Never re-`Write` the whole file unless the structure itself changes — diff-minimal edits keep the doc's history meaningful.

### 6. Iterate with the user

After each user turn:

- If a decision landed, update §3 + §5 (diagram) + §7 (build shape) in a single pass.
- If new information surfaces (e.g., a teammate's opinion, a newly-found code path), verify it against the codebase before recording it.
- If the user asks for your read / recommendation on an open question, give an **honest** analysis naming tensions with existing decisions — don't just agree. But the final call is the user's, and whatever they pick becomes the decision.
- If the user says "forget about question X" or "drop X", move it to §3 as "Dropped as an explicit concern" with a one-line reason.

Keep answering the user's actual question first; the doc edit comes after.

### 7. Summary

At the end of every turn where the doc changed, end with a short (2–4 bullet) summary of:

- What decision landed (or what question was asked).
- Which sections of the doc changed.
- Which questions are still open.
- Optional: any tension or verification the user should be aware of.

Do **not** append long recaps, "next steps" lists, or re-state the whole decision table — the doc already holds that.

## Output artifact

A single markdown file at `docs/<kebab-slug>-eventstorm.md`, structured per Step 5, that a teammate can read cold and understand:

- What is being built and why.
- What has been decided and what is still open.
- What code already exists that the feature will plug into.
- What is deliberately out of scope.

Nothing else is produced. No code, no tests, no scaffolding — those belong to `/build-plan` and `/tdd` once the event storm is settled.