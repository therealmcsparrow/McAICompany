---
name: handoff
description: Use when starting or finishing any aico Step. Defines what a Role may read at the start and the one Handoff file it must write at the end.
---

# Handoff

Every Step starts with a fresh context. The Handoff is the only memory between Steps.

## Starting a Step

Your dispatch prompt gives you:
- **Input Handoffs**: paths under `.company/work/<task>/`
- **Output path**: the one Handoff file you will write
- **Goal**: what this Step must deliver

Rules:
1. Read the input Handoffs first, then only the `.company/project.md` sections you need. Don't read other Steps' Handoffs or browse `.company/work/` to "get context".
2. **Input Handoffs missing *or* output path missing → stop.** Write nothing else. Return `blocked — missing handoff`, and leave it to the Lead to re-dispatch. Never reconstruct context by guessing. The only exception is a dispatch that literally says `Input Handoffs: none: first Step` and quotes the CEO's request.
3. Something the Handoff doesn't answer and the code doesn't show is a blocker. Record it; don't invent it.

## Context budget: 150k tokens

No Role's context may go over **150k tokens**. Past that, quality drops and compaction loses detail, so hand over to a clean Step instead of pushing on.
- Watch it as you work: big file reads, long diffs, test logs and tool output add up fast. Read slices, not whole files; grep before reading.
- When you're near the budget (around 130k, or you can't tell and have done a lot of reading and tool calls), **stop at the next clean point**: tests green or the last change reverted, nothing half-edited.
- Write your Handoff with `status: handover`. `## Did` lists what's finished; `## Next` lists exactly what's left, in order, with file paths, so a fresh Role of the same type can pick it up without re-reading what you read. Commit-ready work only; never leave the tree broken.
- A handover is not a failure and not a blocker. Don't cut scope or skip checks to squeeze under the budget.

## Finishing a Step

Write **exactly one** file at the output path, in this shape:

```markdown
---
step: 03
role: backend-engineer
task: <task-slug>
status: done | blocked | needs-ceo | handover
round: 0            # Fix round this Step belongs to (0 = first pass), copied from the dispatch
base-commit: <sha>  # commit this Step's range is cut from; reviewers diff against it, never HEAD~1
risk-tier: medium   # from the Brief; see the forced-high list below. Builders/QA/reviewers copy it from the dispatch
acceptance-ids: [AC1, AC3]   # the Brief's acceptance-criterion IDs this Step delivers (builders, QA)
files-touched: [src/x.ts]    # files this Step changed, for affected-only tests and the smoke test
---
## Did
- What changed, as facts, with file paths. No narrative.
## Decisions
- Decision — why. (Anything another Role must respect.)
## Blocking
- [contract|spec|security|test] <file:line> — problem — fix. Empty if none.
## Nits
- Non-blocking remarks. These never trigger a Fix round.
## Next
- What the next Step needs to know or do. Name the Role if obvious.
```

**Fields are the contract.** Later Steps and the Lead read these frontmatter fields, not the prose: fill every one that applies. `base-commit`, `acceptance-ids` and `risk-tier` come from the dispatch; `files-touched` is what you changed. A Role that only reasons (reviewer, PM) omits `files-touched`.

**Blocking taxonomy.** Tag each blocker `contract`, `spec`, `security` or `test` so the Lead routes the Fix round precisely. **Risk tier** is `low | medium | high`; it is forced **high** for anything touching auth, payments, personal data, migrations or a Contract — a Role may raise the tier, never lower it.

- `handover`: you hit the context budget (above). The work so far is finished and commit-ready; `## Next` is the remaining work for a fresh Step.
- `needs-ceo`: you need a decision only the CEO can make, e.g. a change to Core, a breaking Contract change, or a scope change. Put the question under Blocking.
- Optional sections, only when `aico:ruleset` asks for them: `## Standards` (builders: Must IDs complied or exception requested) and `## Debt` (old rule violations), placed before `## Next`.
- Keep it under ~60 lines. Link to files; don't paste code.
- Your final reply to the Lead is one line: `<status> — <output path>`.
