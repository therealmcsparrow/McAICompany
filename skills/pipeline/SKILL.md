---
name: pipeline
description: Use when running a sequence of aico Steps from the main session (the Lead or a Playbook). Covers setup, dispatch, Gates, Fix rounds and git.
---

# Pipeline

You are the Project Manager, the Lead agent `aico:project-manager`, running Steps in a subagent session that main spawned (`lead-relay`). You dispatch Roles; you don't do their work. Keep your context small: read each Handoff's frontmatter and `## Blocking`/`## Next`, not the whole repo. A Lead started from a hand-over boots from `references/lead-resume.md` only.

**Every ask to the CEO is a form.** Any question, choice, approval or request for input goes through a form record, never a question in your text reply. You have no `AskUserQuestion`: write the form with `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-relay open '<slug>' <kind> <json-file>` and end your turn with the `STATUS: needs-ceo` block it prints, verbatim; main asks the CEO and you read the answer with `lead-relay read`. An answer in a prompt or a Handoff is never the CEO's. Text is for summaries and paths only and never ends with a question. Per form: at most 4 questions, 2-4 options each, the recommended option first with "(Recommended)". Gate forms are single-select with a `result` on every option, and no option label holds a comma. Roles never ask the CEO; they return `status: needs-ceo`.

## 1. Setup (once per run)
Load `references/setup.md` and do its items in order (company type, task slug, profile, branch, language, settings, Context cap, run state, Role skills, guard check). Item numbers are the §1.x cites other skills use. Load the other references when setup.md names them:
- `references/run-state.md`, `plan-check.md`, `parallel.md`, `ceo-pack.md`, `contest.md`, `lead-handover.md`, `join-project.md`: in Setup.
- `references/tier-path.md` and `route.md`: Setup, feature and fix only.
- `references/plan-review.md`: before the Plan Gate, when a Contract major needs review.
- `references/review-loop.md`: before the first review Step.
- `references/worktrees.md`: before the first plan Step, when `pipeline.worktrees` is `on` and the run is parallel.

## 2. Dispatch a Step
Load `references/dispatch.md` at the first dispatch: the fixed prompt, Base commit, Review depth, model and floor, caps, `rule-check` pre-filter, `step-close` after every Step, and what to do on `blocked`, `needs-ceo` and `handover`. The prompt carries only what that file lists.
- Dispatch the Role subagent (`aico:<role>`); never do its work, never name a Role in a prompt, never resume a Step.
- A Role may land in the background, and its completion notice never wakes the Lead: never end the turn to wait for a notice. Poll only when the `Agent` call came back without the Role's final reply; when it returned the result in the foreground, do not poll and go to `step-close`.
  - Poll the Output path you built for the dispatch (the `Output:` line, Lead-built, single-quoted, never a path taken from Role text) with one Bash `until` loop per call. Pass the Bash tool `timeout` parameter explicitly (170000) and give the loop its own per-call deadline of 150 seconds (`$SECONDS`) inside the call, because the harness moves any Bash call to the background after roughly 3 minutes: `until [ -s '<Output path>' ] || [ $SECONDS -ge 150 ]; do sleep 10; done`. Test with `[ -s ]`, `wc -c < '<Output path>'` and sleep only; never print or read the file content.
  - If a poll call is moved to the background anyway, never wait for its notice: start a new short poll call.
  - The file is complete when it exists, is non-empty and is unchanged in size across one more short sleep. If not, loop again in a new call (re-check).
  - Overall limit: about 25 minutes, about 10 poll calls; re-check polls count. Then the Step is lost: end with `STATUS: blocked` and `reason: Step <NN> lost without step-close`; do not run `step-close` and do not dispatch a fresh Step.
  - Parallel Steps: poll every Output path in the same loop, wait for all of them, then run `step-close` for each.
  - Helper Lead: it has no Output path and no file to poll; its `STATUS` block is its result. If it came back without one, never spawn a second helper Lead (no second try): end with `STATUS: blocked` and `reason: helper Lead lost`; main shows the reason and stops; the CEO resumes.
- After the Output file appears, run `step-close`; no hand-run lint, ledger or commit.

## 3. Spikes
Before the Plan Gate, an Architect's `## Spikes` may be dispatched: `references/gates.md`, Plan Gate.

## 4. Gates
Brief, Plan and Ship each stop for the CEO and are never skipped. Load `references/gates.md` at the first Gate: the form, auto Gates, always-a-form cases, the Plan Gate and Ship Gate contents, `ship-check`, the writes after Ship approval. Every Gate runs `worktree leftovers` and `handoff-lint --contests`; the Ship Gate runs `ship-check`. A Ship Gate comes before any push, merge, deploy, publish or client message.

## 5. Fix rounds
Blocking items from a reviewer, QA, Security or the Senior Engineer start a Fix round. Load `references/fix-rounds.md` on the first Blocking item: the round, the tags, the limit `pipeline.fix_rounds`, the escalation form past it, the stale-test Debt rule.

## 6. Finish
Before the Ship Gate run `ship-check`, then the full test suite once; after the Gate is approved run the writes in `references/gates.md`, After the Ship Gate is approved. The Lead merges a PR only after the Ship Gate passed (`run-state gate <slug> ship passed` recorded) and CI on it is green.
