---
slug: qa-tests-first-active
version: 0.30.0
shipped: 2026-11-08
---
## Problem
In a feature run the builder writes the code and also writes the tests that prove it, so nobody independent decides what "done" means before the build starts. QA and the Code Reviewer only look after the fact, and mistakes surface as Fix rounds: a median of 2 per feature run over the last 30 measured runs. The user served is the CEO running an aico company, who wants a separate test author for every planned task. QA-first existed only as an opt-in idea since 2026-11-05 and no run used it, so there was no data either way.

## Solution
QA writes the failing tests first, in every feature run, at every risk tier, with no opt-out. Fix runs stay as they are, since QA already reproduces the bug test-first there. Every other Playbook is unchanged.

- Plan: each build task (a task that touches code, meaning any task without a valid `seams: none — <reason>`) depends on at least one QA task. A QA task is a task whose Role is `qa`; its files are the tests it owns. Each test file has exactly one owner. The plan check reports a build task with no QA task, a QA task with bad or missing files, and any task whose files overlap a QA task's files. Any such error stops the run start.
- Schedule: the scheduler runs each QA task before the build tasks that depend on it. In a Fix round a build task still waits for its QA task in the same round. A blocker on a test file goes to the QA task that owns it.
- Red first: QA's Handoff lists the test files it owns, each citing AC IDs, and each test fails against the base commit. A test that already passes before the build is a QA Blocking `test` line.
- Ownership: when a builder's diff touches a QA-owned test file, the scope check reports it as `qa-owned`, the task cannot be marked done, and that edit is never committed. The builder reverts its own edit, writes the test change it needs as a Blocking `test` line, and QA makes the change.
- Builder tests: builders may still add their own unit tests. They are allowed but never count as verification for any AC ID.
- Lead: passes the QA-first flag at plan check and run start in every feature run without asking. The CEO sees no new form or flag.
- Contracts: plan-tasks moves to v1.7 (QA-first section, QA-owned scope outcome, the done refusal, the Fix-round wait rule, the red list, the QA-first view key). token-ledger moves to v1.10: the ship record gets a `qa` key (1 when the run was QA-first, else 0), and a new read-only `qa-first-report` command prints three lines: before (median and count of Fix rounds for runs without QA-first), after (the same for QA-first runs, shown as insufficient while fewer than 3 runs), and excluded (count). Both changes are additive minors; every older file and caller stays valid. handoff, dispatch-prompt and idea-flow are unchanged.
- Docs: the changelog, the plans, parallel-steps and review concept pages, the feature command page, the tdd, planning and pipeline skills, the QA agent and the builder agents all describe the same rule.

## User stories
- As the CEO, I start a feature run and QA writes the failing tests for each task before any builder starts, without my passing a flag.
- As the CEO, I can trust that a green test was written by someone other than the builder whose work it checks.
- As the CEO, I run one read-only report and see Fix rounds before and after QA-first, with how many runs each number rests on.
- As the CEO, I start a fix run and it works exactly as before.
- As QA, I own a named set of test files and nobody else can change them without going through me.
- As a builder, I get red tests that tell me when I am done, and I can still write my own unit tests.
- As the Lead, I get a refusal instead of a silent commit when a builder edits a QA-owned test.

## Decisions
- On by default for every feature run, every tier, no opt-out (CEO answer to the brief's Q1). The brief recommended on for medium and high tier only. The CEO chose all tiers so after-data builds up faster and no run is left to judgement. This replaces the brief's AC6 wording about opt-out and low tier.
- Fix runs unchanged: they already reproduce the bug test-first through QA, so a second QA Step would only add cost.
- Seams decide what needs a QA task: a task that declares no seams with a reason gets none. A missing or malformed seams line counts as code, so the check fails closed.
- One owner per test file, so a test failure always routes to one QA task and the Fix round stays unambiguous.
- A builder who edits a QA-owned file is refused at done, not silently reverted. The builder's own Handoff names the needed test change, so the need is not lost.
- Builder unit tests are allowed but are not verification. Banning them would cost builders a useful tool without helping independence.
- Measure: one number, the median Fix rounds per feature run. Baseline from the report over the existing ledgers: before median 2 (n=30), with releases, brainstorm, replay and baseline runs and runs without a Fix-round count excluded. Target: median of 1 or less after 3 QA-first runs, with no rise in high blockers. Measured at this run's Ship Gate (baseline) and in an aico feedback run after 3 QA-first runs. Escaped defects and builder context use are later metrics.
- Rationale recorded in ADR 0064 (ADR numbers 0060 and 0061 left alone, since other branches may hold them).
- Built fresh on main's Contract versions. Nothing is copied from the parked QA-first branch, which also holds route-letter and workflow-doc work that stays out.
- Risk tier high, because two Contracts change and the pipeline skill, a Core path, is edited. The Contract bumps and the Core edit go to the CEO at the Ship Gate.
- Laws: none apply. This is an internal process change with no personal data and no user-facing product.

## Testing decisions
Risk tier high: every criterion has its own test and none is covered lightly. Report fixtures use real ledger record shapes. Acceptance criteria:

- AC1: Given a plan with a build task, When plan-tasks v1.7 checks and schedules it with QA-first on, Then a QA task is ordered before that build task and the build task depends on it; a build task with no QA task is an error and the run start is refused.
- AC2: Given a QA test Step, When QA finishes, Then its Handoff lists the test files it owns, each citing AC IDs, and each fails against the base commit; a test that passes before the build is a QA Blocking `test` line.
- AC3: Given a build Step whose diff changes a QA-owned test file, When the scope check runs, Then it reports the path as QA-owned, done is refused, the edit is not committed and the change goes back to QA.
- AC4: Given a build Step, When the builder adds its own unit tests, Then they are allowed and count as verification for no AC ID.
- AC5: Given a task with a valid seams-none reason, When scheduled, Then no QA task is required for it.
- AC6: Given any feature run, at any tier, When the Lead dispatches, Then QA-first is on with no CEO flag or form and the ship record carries `qa` 1; a fix run or any other Playbook carries `qa` 0 and behaves as before.
- AC7: Given the existing ledgers, When the QA-first report runs, Then it prints before, after and excluded lines; after reads insufficient while fewer than 3 QA-first runs exist; before reproduces median 2 over the existing ledgers (n=30), or each differing run is explained.
- AC8: Given the change, When done, Then a repo-wide pin search finds no stale plan-tasks v1.6 or token-ledger v1.9 reference where the new behaviour is meant, and the changelog, ADR, tdd and planning skills, QA agent and builder agents agree.

## Out of scope
- Route-letter removal, the workflow documentation folder and any idea-flow change.
- Pushing, merging or changing the parked QA-first branch.
- Steno work; a new plugin dependency.
- Any change to fix runs or to Playbooks other than feature.
- A CEO opt-out flag or a per-tier switch.
- Later: escaped-defect and builder-context metrics; a review of the after-data in an aico feedback run once 3 QA-first runs have shipped.
