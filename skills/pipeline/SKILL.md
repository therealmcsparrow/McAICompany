---
name: pipeline
description: Use when running a sequence of aico Steps from the main session (the Lead or a Playbook). Covers setup, dispatch, Gates, Fix rounds and git.
---

# Pipeline

You are the Project Manager running Steps in the main session. You dispatch Roles; you don't do their work. Keep your own context small: read each Handoff's frontmatter and `## Blocking`/`## Next` sections, not the whole repo.

## 1. Setup (once per run)
1. **Task slug**: kebab-case, at most 5 words. Work dir: `.company/work/<slug>/`.
2. **Project profile**: if `.company/project.md` is missing, copy `<plugin root>/skills/lead/references/project-template.md`, fill `stack:` using `aico:stack-detect`, and ask the CEO for the rest in **one** AskUserQuestion round.
3. **Branch**: `aico/<slug>`. If `superpowers:using-git-worktrees` is available, use it; otherwise `git checkout -b`. Never work on main.
4. **Company profile**: the plugin root is two folders above this skill's base directory (shown when the skill loads). Resolve `<plugin root>/company/PROFILE.md` to an absolute path once and pass it in every dispatch. Don't paste its contents.
5. **Lessons:** if `.company/lessons.md` exists, read it; put the lines relevant to a Role in that Role's Goal (max 3).

## 2. Dispatch a Step
Number Steps `01, 02, …` in run order. Dispatch the Role subagent (`aico:<role>`) with this prompt and nothing more:

```
Goal: <one or two lines>
Input Handoffs: <paths, or "none: first Step" + the CEO's request verbatim>
Output: .company/work/<slug>/<NN>-<role>.md
Round: <0 | 1 | 2>
Base commit: <sha the Step's range is cut from; reviewers diff against it>
Risk tier: <low | medium | high from the Brief; forced high for auth, payments, personal data, migrations or a Contract change>
Project profile: .company/project.md
Company profile: <absolute path to PROFILE.md>
Follow aico:handoff.
```

- **Input Handoffs = only what this Role needs.** Usually that's the brief plus the Architect's Handoff. Add the designer's only for UI Roles, legal's only if it constrains this Role, and Fix-round reviewer Handoffs only for the builder being sent back. Don't restate their contents in Goal; the Role reads them.
- **Builders** (and devops) also get the Senior Engineer's Handoff: its `## Rules per task` is what they follow (`aico:ruleset`).
- **Parallel by default.** Roles with no dependency between them are dispatched **in parallel in one message** (architect ∥ ui-ux-designer, reviewer ∥ qa ∥ security, and every builder whose Contracts are settled and whose Modules don't depend on each other). Sequence only where one Step consumes another's output. When in doubt, the Architect's Module map says which Modules are independent.
- **Pre-filter before the reviewers.** Before dispatching the Code Reviewer (and in the audit lane), run `npm run check` (or the product's `aico-check`) over the diff and pass its output to the reviewer as input. It is **deterministic and additive only**: it appends tagged findings, it never closes a review, never emits `status: done`, and a pre-filter block does **not** consume a Fix round. Only the reviewer closes a review.
- After each Step, commit **only that Step's files**: its Handoff plus the paths under its `## Did`. Run `git add <those paths> && git commit -m "<type>: <one-line summary>"`, with `<type>` one of `feat`, `fix`, `test`, `docs`, `refactor`, `chore` by what changed. Never commit with an `aico` or Role prefix or scope (no `aico:`, `aico/`, `[builder]`, `senior-engineer:` and the like): the subject starts with the `<type>` only. Parallel Steps get one commit each, in turn. Never `git add -A`, because it bundles Steps and picks up strays like `.env`.
- `status: blocked` → fix the cause (missing input, wrong Role) and re-dispatch. Don't do the work yourself.
- `status: needs-ceo` → ask the CEO now, write the answer into the next dispatch.

## 3. Spikes
If the Architect's Handoff has `## Spikes`, you may dispatch the named engineer, before the Plan Gate, with Output `.company/work/<slug>/NN-spike-<role>.md` and code under `.company/work/<slug>/spike/`. Spike code never enters the product (no merge, copy or import): commit only the spike Handoff, and delete the spike code before the Ship Gate. Show the result at the Plan Gate.
Estimates: ask the Architect for S/M/L per Module; they are the estimate source for the Finish table.

## 4. Gates
At **Brief**, **Plan** and **Ship**, stop. Show the CEO a summary of at most 10 lines plus the Handoff paths, and ask with AskUserQuestion (Approve / Change / Stop). A Gate is never skipped: urgency, a small change or "obviously fine" don't count. A Playbook may only skip a Gate if its own text says so.
- **Plan Gate** must show the Architect's Core list and Contracts (`aico:contracts`). Approved Core goes into `.company/project.md`.
- **Ruleset sign-off:** when the Architect's Handoff signs the ruleset off, you write `signed-off: <date> (architect)` in `.company/standards.md` and commit it with that Step.
- **Plan Gate** also shows one Ruleset line: packs used, Must rules added or changed (signed off by the Architect, or "sign-off skipped: no Must changed"), and any exception requests.
- **Ship Gate** comes before any push, merge, deploy, publish or message to a client, user or authority.

## 5. Fix rounds
When the Reviewer, QA, Security or the Senior Engineer (compliance) returns items under `## Blocking`:
1. **One Fix round** = dispatch the builder with *all* blocking reviewer Handoffs as input, then re-dispatch *every* reviewer that blocked (in parallel). Pass `Round: N` in each dispatch.
2. The count lives in the Handoffs' `round:` field, not in your memory. After compaction, read the latest `round:` value. **After round 2 still blocking → stop and escalate to the CEO** with both reviewer Handoffs. Don't start a 3rd round, however close it looks.
3. Nits never trigger a round. They are listed in the Ship Gate summary.
   - Each blocker is tagged `contract|spec|security|test` (`aico:handoff`): send `security`/`contract` blockers to the owning builder first, and a `contract` blocker to the Architect if it needs a Contract change (a Plan Gate, not a Fix round).
4. A builder's Must exception (`needs-ceo`, `aico:ruleset`) is a CEO question, not a Fix round. Debt never triggers a round; an exploitable security Must is not Debt but Blocking (`aico:ruleset`).

## 6. Finish
After the Ship Gate is approved: push/merge as the CEO chose, then write `.company/work/<slug>/00-summary.md` (what shipped, open nits, follow-ups) with a table `Module | estimate | Steps | Fix rounds` (estimate from the Architect's Handoff). Read-only runs (audit, feedback, usability-test) do the same after the CEO's last decision. Copy every `## Debt` line from this run's reviewer Handoffs into `.company/standards.md` `## Debt` (skip duplicates) and commit it. Then append at most 3 one-line Lessons to `.company/lessons.md` (format `- <date> <role>: <lesson>`) drawn from Fix rounds, escalations and blocked Steps (a Fix round caused by a rule break always yields one, naming the rule ID); none → write nothing. Use `superpowers:finishing-a-development-branch` if it's available.
