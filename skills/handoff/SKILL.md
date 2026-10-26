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

Write **exactly one** file at the output path, in this shape. Everything for the next Step goes here, never in code comments (`aico:tdd`).

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
By: <Name> (<role>)
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

**By line.** `By: <Name> (<role>)` goes directly under the frontmatter, from your dispatch's `Name:` line; with no `Name:`, use the Role title. Display only; machine reading ignores it.

**Fields are the contract.** Later Steps and the Lead read these frontmatter fields, not the prose: fill every one that applies. `base-commit`, `acceptance-ids` and `risk-tier` come from the dispatch; `files-touched` is what you changed. A Role that only reasons (reviewer, PM) omits `files-touched`.

**Blocking taxonomy.** Tag each blocker `contract`, `spec`, `security` or `test` so the Lead routes the Fix round precisely. **Risk tier** is `low | medium | high`; it is forced **high** for anything touching auth, payments, personal data, migrations or a Contract — a Role may raise the tier, never lower it.

- `handover`: you hit the context budget (above). The work so far is finished and commit-ready; `## Next` is the remaining work for a fresh Step.
- `needs-ceo`: you need a decision only the CEO can make, e.g. a change to Core, a breaking Contract change, or a scope change. Put the question under Blocking.
- Optional sections, only when `aico:ruleset` asks for them: `## Standards` (builders: Must IDs complied or exception requested) and `## Debt` (old rule violations), placed before `## Next`.
- Keep it under ~60 lines. Link to files; don't paste code.
- Your final reply to the Lead is one line: `<status> — <output path>`.

## Handoff v1.1 (pilot)
Contract: `docs/contracts/handoff.md`. A v1.0 Handoff stays valid; v1.1 only adds. The Lead runs `node scripts/handoff-lint.mjs <file>` after each Step, with `--require-top` for `code-reviewer` and `senior-engineer` compliance-pass Handoffs. A malformed top block blocks the Step: you are re-dispatched with the lint errors; it costs no Fix round.

**Top block.** Directly after the `By:` line, before `## Did`, one fence with info string `aico-top`. Exactly these keys, in this order, one line each, nothing else:

````markdown
By: Rin (code-reviewer)
```aico-top
status: done
files: [src/x.ts]
ac_ids: [AC1]
rule_ids: [proj.M3]
risks: [R-1]
read_next: [src/x.ts#top, R-1]
tokens_used: unknown
```
````

- `status`, `files`, `ac_ids` repeat the frontmatter `status`, `files-touched`, `acceptance-ids` (same set; `[]` when absent). A mismatch is malformed.
- `rule_ids`: rule IDs you applied or checked. `risks`: finding IDs that carry a risk. `read_next`: at most 5 pointers (`path`, `path#heading`, `R-n`), never copied text. `tokens_used`: your own integer count or `unknown`.
- Only one block; lines under 1000 characters.

**Finding rows (pilot Roles).** In `## Blocking` and `## Nits`, one row per finding:
- Blocking: `- [contract|spec|security|test] <ID> | <file>[:<line>[-<line>]] | <problem> | <why> | <fix>`
- Nit: `- <ID> | <file>[:<line>] | <problem> | <why> | <fix>`
- `<ID>` is `R-<n>` (review), `C-<n>` (compliance pass) or `T-<n>` (tool check). IDs are stable across Fix rounds and never reused. `why` is never empty. Builders cite IDs in `## Did` (`fixed R-2`).
- No `|` inside a field.

**Findings ledger.** A pilot reviewer keeps `<NN>-<role>.findings.md` while working (frontmatter `step`, `role`, `base-commit`; `## Checked` file list; `## Findings` rows `- R-1 | open | [spec] | file:line | problem | why | fix`, status `open|fixed|withdrawn`). Rows are appended or change status, never deleted. A handover or Fix-round reviewer continues the same file. Check it with `node scripts/handoff-lint.mjs --findings <file>`.

## Language
Your dispatch carries `Language: <tag>`. Write the prose in `<tag>`: Handoff text, forms, Gate summaries, digests, reports, lessons, cooler lines, brainstorm replies. Commit subjects are `<type>: <summary in tag>`.
- **Always English** (machine-read): frontmatter keys and values, `##` headings, `status:` values, blocking tags `contract|spec|security|test`, AC IDs, file and folder names, slugs, branches, command, Role and Contract names, report `## ` headings. Example: `## Did` stays, the bullets under it are in `<tag>`.
- **Code comments** you write: in `<tag>`, unless the product's Ruleset or the existing comments in that codebase use another language; then follow the codebase. Identifiers, code, log keys and API names stay code. Product UI and user docs follow `languages:` in `.company/project.md`, never `Language:`.
- `Language:` absent → `en`. Value not a valid tag → `en`, and add a Nit `invalid Language <value>` (never echo more than 35 characters). `en` → no translation, no extra text.
- `Design skills:` (UI Roles only): load each named skill with the Skill tool. One that isn't available → `missing design skill: <name>` under `## Next`; never skip silently. Absent → `none`.
