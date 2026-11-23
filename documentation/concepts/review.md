# Review

## In short
Before anything ships, other Roles check the builder's work: automatic checks first, then a reviewer who judges logic and Contracts. If you switch plan review on, a fresh reviewer also reads plans as a newcomer. A builder may disagree with a finding, but only with evidence.

## How it works
1. A cheap script scans the diff and hands its findings to the reviewer.
2. Review depth follows the paths touched, not the builder's own label.
3. The Code Reviewer judges the diff against the brief, then reads what the builder wrote.
4. A blocking finding sends the builder back in a Fix round (see [Fix rounds](#fix-rounds)).
5. There is one code reviewer. The second reviewer, which used to look at high risk, is gone.

## Technical details
### Tool checks, slices and review depth
- **Tool checks.** A rule can carry `check: <tool>` or `check: judgment`. Checks bind to a rule by its ID in `.company/checks.json` and run before review. A failure becomes a finding that the reviewer must confirm before it blocks. Compliance stays a separate lane.
- **Rule slices.** Each task gets only its mapped rules, and always every security Must. The Senior Engineer renders them into one small file per task, `.company/work/<slug>/rules/<task>.md`, with the rule text included. Builders get that file instead of the full ruleset map. `rule-check slices` verifies the files and flags missing, stale or extra ones.
- **One review format.** The pilot format (a top block, `ID | file:line | problem | why | fix` rows and a findings ledger) and the setting `pipeline.review_format` are removed. A reviewer writes an ordinary Handoff. Each blocking finding still carries an ID such as `R-2`, so a builder can cite or contest it. A reviewer that hands over mid-review lists what is left under `## Next`.
- **Review depth** follows the paths touched (`scripts/review-depth.mjs`), not the builder's own label. Contract, Core and security paths always get a full review.
- **Security below high risk.** At medium risk the Security Step is skipped when the diff touched no security-relevant path (config, Contract, binary or unknown files, `hooks/`, `mods/`, `.github/` and similar, or a path the project lists). The Code Reviewer then runs the security checklist itself. If the risk tier is raised later, or a later change touches such a path, the Ship Gate blocks until Security has run.
- **Golden Handoffs and the regression set.** Reference Handoffs and past high-tier defects run under `npm test`, so a change that loosens a Gate or the Handoff shape fails a test.

### The reviewer pre-filter
Before the Code Reviewer runs, a cheap deterministic check (the same `aico-check` the CI uses) scans the diff and hands its findings to the reviewer. It is **additive only**: it can append tagged findings but never remove, downgrade or close one, never marks a review done, and a pre-filter block never counts against the Fix-round limit. Only the Opus reviewer closes a review. This spends human-grade attention on logic and Contracts, not mechanics — without softening any Gate.

### Fix rounds
When a reviewer, QA, Security or the Senior Engineer (compliance, high risk only) finds a blocking problem, the builder is sent back — at most **twice** by default. After the last round the Lead asks you one form with three options, in this order: Ship with Debt (Recommended), Cut scope, Extra round. A fail caused only by a stale test expectation goes to Debt, not to Blocking. You can set the limit from 0 to 5 in [settings](settings-and-locks.md); at 0 the first blocking review comes straight to you. Nits never start a round; a nit on a Contract or Core path gets one extra builder Fix Step, which is not a round and does not count toward the limit. The run's count stops at your first answer at the Ship Gate. A finding caused by a choice the plan left open is also listed as a Nit tagged `[open-decision]`; a real bug it caused stays Blocking. See [Plan check](plans.md#plan-check).

**QA-first and Fix rounds.** In feature runs QA writes the failing tests before the builder starts, one QA task per Module wave (see [Plans](plans.md#qa-first-in-feature-runs)). `ledger qa-first-report` prints the median Fix rounds of runs without it (`before`) and with it (`after`), plus the runs left out (`excluded`). `after` reads `insufficient` until three runs count. Fix runs are not QA-first.

### Judging changes
These checks apply to every run from v0.20.0.
- **Base commit.** The `Base commit:` of a prompt is the full object id (40 or 64 hex digits), never a short sha or a ref. Reviewers judge the diff from that base to the run branch.
- **Grafts.** A git grafts file makes every judging check stop: tier checks answer `diff unknown`, review depth goes to `full`, and `rule-check` refuses to run.
- **Binary files.** Binary is decided by file content. The binary type list is fixed. A file outside the list that holds binary content in a text path (`binary content in a text path`) blocks until it is fixed or you grant an exception. A text file marked binary by git attributes is shown to reviewers through `rule-check text`, never through a path they type.
- **Contested findings.** A builder can contest a reviewer finding instead of fixing it. Every reviewer finding has an ID of the form `<NN>-<role>:R-<n>`. A security finding never closes by contest.

### The fresh reviewer
**Fenna** (`fresh-reviewer`) reads a plan as a newcomer. It no longer reviews code. It is one of six protected Roles: it never runs below Opus and never edits code.
- **Plan review (off by default).** The setting `pipeline.plan_review` (`off` or `on`) is `off` at every risk tier. A plan that raises a Contract's major version gets a plan review only when you turn it on. When it runs, after the Architect and before the builders start it gets only an inputs file (the plan, its Contracts and the code paths the plan cites), never the brief. It writes `## Paraphrase`, the plan in its own words, then `## First pass`, its findings, and only then reads the Architect's Handoff. Feature and fix have no Plan Gate; the Ship Gate summary shows the plan review block (the paraphrase and the findings), so you see what a newcomer understood. A finding that the paraphrase differs from the intent is tagged `[comprehension]`: the fix is a text change and it cannot be contested. It blocks on task or Contract level gaps and security problems, not on single-line wording. The Architect revises once and there is no re-check: a security finding closes only by a fix you accept or your exception, and every other open finding is shown in the Ship Gate summary. With the setting off, the Ship Gate summary shows `plan review: not run`, and `plan review: not run (no Contract major)` when no major was raised.
- **No second reviewer.** The second reviewer is removed, with `pipeline.second_reviewer` and `pipeline.second_reviewer_model`. The Code Reviewer is the only code reviewer at every tier.
- **Failed reviews.** A review Step that crashes, writes no Handoff or fails the lint is retried once, then recorded as `not run`. A `not run` stays on the Ship Gate list and the round is not clean; for the security, pentest and vulnerability lanes it is a Blocking line you must answer. The churn check (a Fix round whose lines draw a new Blocking finding) is removed; the Fix-round limit alone ends the rounds.
- **Evals.** Before each release the Lead runs five seeded plan flaws (target 4 of 5) and two seeded code flaws (target 2 of 2) and the Gate Report shows the result. It never blocks a release.

### Contests, escalation and rulings
A builder may answer a Blocking finding with a `## Contested` line instead of a change, once. The line must carry `— evidence:` with 1 to 3 references the reviewer can read: a file, a file and line, or a file and a test name. "Intentional" alone is not evidence and the finding stays Blocking. When the evidence is a decision only you can make, the builder writes an `escalate` line with a reason, and the finding goes to you at the next Gate as `escalated`. Only your own answer closes it, recorded in `.company/work/<slug>/rulings.md` as `upheld` or `overruled`. A security finding is never overruled and a `[comprehension]` finding is never contested.

At each Gate of a run with an escalation or an exception, the Lead pastes `handoff-lint --applied` unchanged: every ruling and every exception on file for this run, each shown as a quoted line for you to confirm. "Not mine" on a ruling asks the question again; "not mine" on an exception stops the run until you remove or confirm the line in `.company/standards.md`. An exception counts only for the run it names, and only when it is dated on or after that run's latest start. Moving from v1.2: see [Migration from v1.2](../../docs/contracts/handoff.md#migration-from-v12).
