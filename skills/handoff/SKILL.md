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
6. **Task: and Files:** (a plan-task Step, `dispatch-prompt` v4): other Steps may be working in the same tree right now. Change only the paths in `Files:` and your Handoff; a path you must change outside them goes in `files-touched`, with the reason under `## Decisions`. Never `git stash`, and never `git checkout`, `restore`, `reset` or `clean` paths you did not change. Never kill processes by image or name (`taskkill /IM`, `pkill`, `killall`); stop only PIDs you started. Run only the test files for your paths; the Lead runs the full suite once. A `Worktree: <path>` line → change files only under that path, run git only as `git -C <path>`, never read or change the main tree's working files; every limit above applies inside it. Use absolute paths only, never `cd` or `Set-Location` into it, and never `git stash` (worktrees share one stash list). `Files: none` or no `Files:` line → change only what your Goal names and list every changed path. A `Task brief:` line (v4) is your slice of the plan: read it, never the full plan; a gap → `status: blocked`, `missing plan context: <what>`.

## Context budget: the `Context cap:` line

Your dispatch carries `Context cap: <cap> handover <n>`, always `95000 handover 85500`: `<cap>` is your context limit, `<n>` the handover point. You never compute them. Past the cap quality drops, so hand over to a clean Step.
- Absent → cap 95000, handover at 85500. Malformed → the same, plus a Nit `invalid Context cap` (`dispatch-prompt` v4).
- Big reads, long diffs and test logs add up: read slices, grep first. Near `<n>` (or you can't tell and have done a lot of reading), **stop at the next clean point**: tests green or the last change reverted, nothing half-edited.
- Write `status: handover`: `## Did` what's finished, `## Next` what's left, in order, with file paths, so a fresh Role of the same type continues without re-reading. Commit-ready work only. A handover is not a failure or a blocker; never cut scope or skip checks to squeeze under the budget.
- **Forced hand-over** (`context-guard` v1, `docs/contracts/context-guard.md`): a hook enforces `<n>` while a run is active. At or over `<n>`, every tool of your Step is refused except one `Write` of a new `<NN>-<role>.md` Handoff in the run folder. The refusal reads `aico context cap: this Step reached the hand-over point. Write your Handoff with status: handover to your Output path now, then end. Every other tool is refused.` Write that Handoff at once, with `status: handover`, `## Did` and `## Next`, then end. A stop without one is blocked once (`aico context cap: this Step was refused tools at the hand-over point. If your Handoff is not written yet, write it now with status: handover to your Output path. Then end.`). The reading lags one tool result, so keep reads small and hand over early by yourself.

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

`By:` is your Role id. **Fields are the contract:** the Lead and Steps read the frontmatter, not prose; fill each that applies. `round`, `base-commit` (the full object id; reviewers diff against it, never `HEAD~1`), `acceptance-ids` and `risk-tier` come from the dispatch; `files-touched` is what you changed (omit if none); `contracts:` is required.

**Blocking tags** `contract`, `spec`, `security`, `test` route the Fix round. **Risk tier** `low | medium | high` is forced **high** for anything touching auth, payments, personal data, migrations or a Contract; a Role may raise it, never lower it.

- `needs-ceo`: a decision only the CEO can make (a change to Core, a breaking Contract change, a scope change); put the question under Blocking.
- Only when `aico:ruleset` asks: `## Standards` (builders: Must IDs complied or exception requested) and `## Debt` (old violations), before `## Next`.
- Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.
- Redact any sensitive information, such as API keys, passwords, or personally identifiable information.
- Under ~60 lines; link to files, don't paste code. Your final reply to the Lead is one line: `<status> — <output path>`.

## Language
Your dispatch carries `Language: <tag>`. Write prose in `<tag>`: Handoffs, forms, Gate summaries, digests, reports, lessons, cooler lines, brainstorm replies. Commit subjects are `<type>: <summary in tag>`.
- **Always English** (machine-read): frontmatter keys and values, `##` headings, `status:` values, blocking tags, AC IDs, file and folder names, slugs, branches, commands, Role and Contract names, report `## ` headings.
- **Code comments**: in `<tag>`, unless the product's Ruleset or the existing comments in that codebase use another language; then follow the codebase. Identifiers, code, log keys and API names stay code. Product UI and user docs follow `languages:` in `.company/project.md`, never `Language:`.
- `Language:` absent → `en`. Value not a valid tag → `en` and a Nit `invalid Language <value>` (echo at most 35 characters).
- `Design skills:` (UI Roles only): load each named skill with the Skill tool. One not available → `missing design skill: <name>` under `## Next`; never skip silently. Absent → `none`.

## Session hand-off

Only when the user asks for a session hand-off. A Role finishing a Step skips this section and writes its Output as above.

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS ($TMPDIR, else /tmp; %TEMP% on Windows) - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

The duplication and redaction rules of `## Finishing a Step` apply.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
