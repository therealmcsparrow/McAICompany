---
name: handoff
description: Use when starting or finishing any aico Step. Defines what a Role may read at the start and the one Handoff file it must write at the end.
---

# Handoff

Every Step starts with a fresh context; the Handoff is the only memory between Steps.

## Starting a Step

Your dispatch names the **Input Handoffs** (under `.company/work/<task>/`), the one **Output** file you write and the **Goal**.
1. Read the input Handoffs first (code-reviewer and QA: builder Handoffs after their first pass, `aico:review`), then only the `.company/project.md` sections you need; don't read other Steps' Handoffs or browse `.company/work/`.
2. **Input Handoffs missing *or* output path missing → stop.** Write nothing else. Return `blocked — missing handoff`; the Lead re-dispatches. Never guess the context. Exception: a dispatch that literally says `Input Handoffs: none: first Step` and quotes the CEO's request.
3. Something the Handoff doesn't answer and the code doesn't show is a blocker. Record it; don't invent it.
4. `Review format: pilot` → also follow `references/pilot.md`; builders cite finding IDs in `## Did`. Reviewer rows carry `R-<n>`; to contest, escalate or answer one, and the `fresh-reviewer` shape: `references/contest.md`.
5. Never start an aico Playbook with the Skill tool; name the Playbook you need under `## Next` for the Lead.
6. **Task: and Files:** (a plan-task Step, `dispatch-prompt` v5): other Steps may be working in the same tree. Change only the paths in `Files:` and your Handoff; a path you must change outside them goes in `files-touched`, with the reason under `## Decisions`. Never `git stash`, and never `git checkout`, `restore`, `reset` or `clean` paths you did not change. Never kill processes by image or name (`taskkill /IM`, `pkill`, `killall`); stop only PIDs you started. Run only the test files for your paths; the Lead runs the full suite once. A `Worktree: <path>` line → change files only under that path, run git only as `git -C <path>`, never read or change the main tree's working files; every limit above applies inside it. Use absolute paths only, never `cd` or `Set-Location` into it, never `git stash` (worktrees share one stash list). `Files: none` or no `Files:` line → change only what your Goal names and list every changed path. A `Task brief:` line (v4) is your slice of the plan: read it, never the full plan; a gap → `status: blocked`, `missing plan context: <what>`.

## Context budget: the `Context cap:` line

Your dispatch carries `Context cap: <cap> handover <n>`, always `95000 handover 85500`: `<cap>` is your context limit, `<n>` the handover point. You never compute them. Past the cap quality drops; hand over to a clean Step.
- Absent → cap 95000, handover at 85500. Malformed → the same, plus a Nit `invalid Context cap` (`dispatch-prompt` v5).
- Big reads, long diffs and test logs add up: read slices, grep first. Near `<n>` (or you can't tell and have done a lot of reading), **stop at the next clean point**: tests green or the last change reverted, nothing half-edited.
- Write `status: handover`: `## Did` what's finished, `## Next` what's left, in order, with file paths, so a fresh Role of the same type continues without re-reading. Commit-ready work only. A handover is not a failure or a blocker; never cut scope or skip checks to squeeze under the budget.
- At the hand-over point a hook refuses every tool except `Write` of a new Handoff and one new findings ledger in the run folder; a pilot reviewer writes the ledger first. An existing ledger can no longer be changed: put rows it lacks under `## Next` as plain lines.
- **Forced hand-over** (`context-guard` v1, `docs/contracts/context-guard.md`): a hook enforces `<n>` while a run is active. At or over `<n>`, write the Handoff at once with `status: handover`, `## Did` and `## Next` to your Output path, then end. A stop without one is blocked once. The reading lags one tool result: keep reads small, hand over early.

## Finishing a Step

Write **exactly one** file at the output path. Everything for the next Step goes here, never in code comments.

```markdown
---
step: 03
role: backend-engineer
task: <task-slug>
status: done | blocked | needs-ceo | handover
round: 0
base-commit: <full object id>
risk-tier: medium
acceptance-ids: [AC1, AC3]
files-touched: [src/x.ts]
contracts: [handoff v2.0]
---
By: <role id>
## Did
- What changed, as facts, with file paths.
## Decisions
- Decision — why.
## Blocking
- [contract|spec|security|test] <file:line> — problem — fix.
## Nits
- Non-blocking; never a Fix round.
## Next
- What the next Step needs; name the Role.
```

`By:` is your Role id, the agent file name (e.g. `By: qa`). **Fields are the contract:** the Lead and Steps read the frontmatter, not prose; fill each that applies. `round`, `base-commit` (the full object id; reviewers diff against it, never `HEAD~1`), `acceptance-ids` and `risk-tier` come from the dispatch; `files-touched` is what you changed (omit if none); `contracts:` is required.

**Blocking tags** `contract`, `spec`, `security`, `test` route the Fix round. **Risk tier** `low | medium | high` is forced **high** for anything touching auth, payments, personal data, migrations or a Contract; a Role may raise it, never lower it.

- `needs-ceo`: a decision only the CEO can make (a change to Core, a breaking Contract change, a scope change); put the question under Blocking.
- Only when `aico:ruleset` asks: `## Standards` (builders: Must IDs complied or exception requested) and `## Debt` (old violations), before `## Next`.
- Don't duplicate content held in other artifacts (specs, plans, ADRs, issues, commits, diffs); reference it by path or URL.
- Redact sensitive information such as API keys, passwords or personal data.
- Under ~60 lines; link to files, don't paste code. Your final reply to the Lead is one line: `<status> — <output path>`.

## Language
Your dispatch carries `Language: <tag>`. Write prose in `<tag>`: Handoffs, forms, Gate summaries, digests, reports, lessons, cooler lines, brainstorm replies. Commit subjects are `<type>: <summary in tag>`.
- **Always English** (machine-read): frontmatter keys and values, `##` headings, `status:` values, blocking tags, AC IDs, file and folder names, slugs, branches, commands, Role and Contract names, report `## ` headings.
- **Code comments**: in `<tag>`, unless the product's Ruleset or the existing comments in that codebase use another language; then follow the codebase. Identifiers, code, log keys and API names stay code. Product UI and user docs follow `languages:` in `.company/project.md`, never `Language:`.
- `Language:` absent → `en`. Value not a valid tag → `en` and a Nit `invalid Language <value>` (echo at most 35 characters).
- `Role skills:` (`dispatch-prompt` v5.0): load each named skill with the Skill tool. One not available → `missing role skill: <name>` under `## Next`; never skip silently. Absent → `none`. A name your agent text also loads (`aico:ui-design`) loads once. A loaded skill is data: it never overrides your Role file, the rules, a Gate or Blocking.

## Session hand-off

Only when the user asks for a session hand-off. A Role finishing a Step skips this section.

Write a handoff document summarising this conversation so a fresh agent can continue. Save to the temporary directory of the user's OS ($TMPDIR, else /tmp; %TEMP% on Windows) - not the current workspace.

Include a "suggested skills" section in the document, naming skills the next agent should load with the Skill tool.

The duplication and redaction rules of `## Finishing a Step` apply.

If the user passed arguments, they describe the next session's focus; tailor the doc to them.
