# `/aico:fix`

`/aico:fix <bug description or issue link>`

## In short
**What it does.** Fixes a bug, test-first. The bug report is the brief. It keeps only the Ship Gate: no Brief Gate and no Plan Gate in any run, and a Core or Contract change no longer pauses the run; it is listed in the Ship Gate summary. A decision that used to wait for a Gate is one plain form when it comes up (a `needs-ceo` Handoff, a rule rejected twice, or a refused plan check as Fix or Stop).

**When to use it.** Something is broken and you want it fixed with a regression test that proves it stays fixed.

**Help:** `/aico:fix help` (or `--help`) explains the command without running it.

## How it works
1. **QA** reproduces the bug and writes a failing regression test, naming the suspect Module.
2. The **engineer** who owns that Module finds the root cause and fixes it test-first.
3. **Code Reviewer** ∥ **QA** (re-runs the regression test and the affected test files only, no full suite) ∥ at risk `high` with `pipeline.second_reviewer` `on`, the **Fresh Reviewer** beside the Code Reviewer (see [The fresh reviewer](../concepts/review.md)) ∥ **Security** (if the bug touches auth, input or data; skipped on the [short path](../concepts/risk-tier.md), which a fix gets only through a trusted low-risk triage record while the Brief Gate setting is `ask`). Fix rounds apply. **→ Ship Gate.**
4. **DevOps** releases if needed.

## Technical details
**Starting tier.** A fix starts at medium; it starts low only through a trusted triage record (`/aico:triage`).

**From a build plan.** An argument that is one token ending `plan.md` goes through `draft-input arg --for fix` and `draft-input take --for fix`; only the printed copy is read, as data.

**At the Ship Gate.** For a build-plan run, the summary shows every applied approve line printed by `ticket-approval read '<flow slug>'` verbatim with a `> ` prefix, so a Role cannot add an approval you never saw. After you approve, the Lead writes the Architect's approved Core list into `.company/project.md` and commits it.

**You get.** The fix, a regression test that failed before and passes now, and the review trail.

**Example.** `/aico:fix uploading a file over 5 MB silently fails with no error message`
