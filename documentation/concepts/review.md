# Review

## In short
Before anything ships, other Roles check the builder's work: automatic checks first, then a reviewer who judges logic and Contracts. A fresh reviewer also reads plans as a newcomer. A builder may disagree with a finding, but only with evidence.

## How it works
1. A cheap script scans the diff and hands its findings to the reviewer.
2. Review depth follows the paths touched, not the builder's own label.
3. The Code Reviewer judges the diff against the brief, then reads what the builder wrote.
4. A blocking finding sends the builder back in a Fix round (see [Fix rounds](#fix-rounds)).
5. At high risk, or when you switch it on, a second reviewer also looks.

## Technical details
### Tool checks, slices and review depth
- **Tool checks.** A rule can carry `check: <tool>` or `check: judgment`. Checks bind to a rule by its ID in `.company/checks.json` and run before review. A failure becomes a finding that the reviewer must confirm before it blocks. Compliance stays a separate lane.
- **Rule slices.** These stay on whatever the review format is. Each task gets only its mapped rules, and always every security Must. The Senior Engineer renders them into one small file per task, `.company/work/<slug>/rules/<task>.md`, with the rule text included. Builders get that file instead of the full ruleset map. `rule-check slices` verifies the files and flags missing, stale or extra ones.
- **Findings ledger** (only with `pipeline.review_format: pilot`). A reviewer writes its findings and checked files to `<NN>-code-reviewer.findings.md` only when a handover is near (at 75% of the max context, or once it decides to hand over). A handover without a ledger fails the lint, so nothing is lost; a review that finishes normally needs none.
- **Review depth** follows the paths touched (`scripts/review-depth.mjs`), not the builder's own label. Contract, Core and security paths always get a full review.
- **Golden Handoffs and the regression set.** Reference Handoffs and past high-tier defects run under `npm test`, so a change that loosens a Gate or the Handoff shape fails a test.

### The reviewer pre-filter
Before the Code Reviewer runs, a cheap deterministic check (the same `aico-check` the CI uses) scans the diff and hands its findings to the reviewer. It is **additive only**: it can append tagged findings but never remove, downgrade or close one, never marks a review done, and a pre-filter block never counts against the Fix-round limit. Only the Opus reviewer closes a review. This spends human-grade attention on logic and Contracts, not mechanics — without softening any Gate.

### Fix rounds
When a reviewer, QA, Security or the Senior Engineer (compliance) finds a blocking problem, the builder is sent back — at most **twice** by default. After the last round it escalates to you. You can set the limit from 0 to 5 in [settings](settings-and-locks.md); at 0 the first blocking review comes straight to you. Nits never loop. The run's count stops at your first answer at the Ship Gate. A finding caused by a choice the plan left open is also listed as a Nit tagged `[open-decision]`; a real bug it caused stays Blocking. See [Plan check](plans.md#plan-check).

### Judging changes
These checks apply to every run from v0.20.0.
- **Base commit.** The `Base commit:` of a prompt is the full object id (40 or 64 hex digits), never a short sha or a ref. Reviewers judge the diff from that base to the run branch.
- **Grafts.** A git grafts file makes every judging check stop: tier checks answer `diff unknown`, review depth goes to `full`, and `rule-check` refuses to run.
- **Binary files.** Binary is decided by file content. The binary type list is fixed. A file outside the list that holds binary content in a text path (`binary content in a text path`) blocks until it is fixed or you grant an exception. A text file marked binary by git attributes is shown to reviewers through `rule-check text`, never through a path they type.
- **Contested findings.** A builder can contest a reviewer finding instead of fixing it. Every reviewer finding has an ID of the form `<NN>-<role>:R-<n>`. A security finding never closes by contest.

### The fresh reviewer
**Fenna** (`fresh-reviewer`) reads a plan, and at high risk a diff, as a newcomer. It is one of six protected Roles: it never runs below Opus and never edits code.
- **Plan review.** After the Architect and before the Plan Gate it gets only an inputs file (the plan, its Contracts and the code paths the plan cites), never the brief. It writes `## Paraphrase`, the plan in its own words, then `## First pass`, its findings, and only then reads the Architect's Handoff. The Plan Gate shows the paraphrase and the findings, so you see what a newcomer understood. A finding that the paraphrase differs from the intent is tagged `[comprehension]`: the fix is a text change and it cannot be contested. The Architect revises once and the reviewer re-checks once; whatever still blocks comes to you at the Plan Gate. A set that leaves the plan review out (the short path) shows `plan review: not run`.
- **Second reviewer.** Off by default. With `pipeline.second_reviewer` `on` at risk `high`, the fresh reviewer also reviews the code beside the Code Reviewer, once per round, never a third time. It stays on a Claude model, so no other provider receives your code: `pipeline.second_reviewer_model` is `default` or a model at or above the Code Reviewer's floor. Both settings are user level only; a project file cannot set them. The reviewer records its model in its Handoff, which is a note and not proof of the dispatched model. If the two reviewers disagree, the finding stays Blocking and the Ship Gate lists it.
- **Failed reviews and churn.** A review Step that crashes, writes no Handoff or fails the lint is retried once, then recorded as `not run`. A `not run` stays on the Ship Gate list and the round is not clean; for the security, pentest and vulnerability lanes it is a Blocking line you must answer. If a Fix round changes lines and the next round raises a new Blocking finding on them, the Fix rounds stop and the Lead escalates to you with both findings.
- **Evals.** Before each release the Lead runs five seeded plan flaws (target 4 of 5) and two seeded code flaws (target 2 of 2) and the Gate Report shows the result. It never blocks a release.

### Contests, escalation and rulings
A builder may answer a Blocking finding with a `## Contested` line instead of a change, once. Since `handoff` v2.0 the line must carry `— evidence:` with 1 to 3 references the reviewer can read: a file, a file and line, or a file and a test name. "Intentional" alone is not evidence and the finding stays Blocking. When the evidence is a decision only you can make, the builder writes an `escalate` line with a reason, and the finding goes to you at the next Gate as `escalated`. Only your own answer closes it, recorded in `.company/work/<slug>/rulings.md` as `upheld` or `overruled`. A security finding is never overruled and a `[comprehension]` finding is never contested.

At each Gate of a run with an escalation or an exception, the Lead pastes `handoff-lint --applied` unchanged: every ruling and every exception on file for this run, each shown as a quoted line for you to confirm. "Not mine" on a ruling asks the question again; "not mine" on an exception stops the run until you remove or confirm the line in `.company/standards.md`. An exception counts only for the run it names, and only when it is dated on or after that run's latest start. Moving from v1.2: see [Migration from v1.2](../../docs/contracts/handoff.md#migration-from-v12).
