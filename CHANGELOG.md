# Changelog

All notable changes to the aico plugin. Versions follow the plugin's own releases.

## [Unreleased]

### Added
- **`aico:wizard`.** DevOps hands the CEO manual steps (dashboards, credentials, CI secrets) as a bash wizard built from `skills/wizard/template.sh`: one stage at a time, hidden secret entry, `.env` upserts, `gh secret` writes, a confirm before anything irreversible.

### Changed
- **No `mattpocock-skills` dependency.** aico no longer installs or names the `mattpocock-skills` plugin; only `superpowers` stays a dependency. `aico:tdd` now carries what a good test is, implementation-coupled tests and mocking at system boundaries; `aico:debugging` carries the full loop-first diagnosis (feedback loop, minimise, ranked falsifiable hypotheses, tagged instrumentation, regression test, cleanup); `aico:sourcing` traces every claim to the source that owns it. The research presence check no longer asks for a plugin skill. Contract `skills-manifest` v2.2.

## [0.23.0] - 2026-10-30

Rollback: node scripts/stable.mjs 0.22.0

### Added
- **Idea and bug flow.** `/aico:idea` and `/aico:bug` take a rough idea or a bug report through one route: capture, grill choice, reprompt, then you pick from routes A Water cooler, B Brainstorm, C Research, D Spec and tickets, E Park the idea, ticket forms, and F (build) or G (park tickets in `.company/roadmap/`); Park the idea writes to `.company/ideas/<name>/`. The allowed picks of every form come from `idea-flow options`, never from the Lead's text. The two commands share the route in `skills/idea/references/routes.md` and run each step in the same session. They differ only in the build Playbook: `idea` builds through `/aico:feature`, `bug` through `/aico:fix`. Contract `idea-flow` v1.1 (new), ADR 0048. Outside a software company the flow offers no Spec and tickets and no Build: the routes are Water cooler, Brainstorm, Research and Park the idea; after Research the form is Park the idea / Stop.
- **Route F records the build pick after the plan exists.** Build tickets are written to `.company/work/<slug>-build/plan.md` first; only when `ticket-approval build-plan` has built it does the flow `pick` F and go on to triage and the build. If an earlier session already built the plan, the flow stops and tells you to archive the folder (never deletes it) and `resume`. The one build run takes all approved tickets.
- **Three grill commands.** `/aico:grilling`, `/aico:grill-me` and `/aico:grill-with-docs` interview you about a plan, one question at a time. `grilling` looks up repo facts and asks the rest; `grill-me` asks every branch and looks nothing up; `grill-with-docs` searches `docs/`, `GLOSSARY.md` and `docs/adr/` first, cites a doc for each closed branch and proposes GLOSSARY and ADR lines (no web search). `/aico:grill` is unchanged. Contract `grill-file` v1.1 (additive).
- **Ticket approval.** Each ticket is approved once. Its hash is the first 12 hex of SHA-256 over its task block; a ticket changed after approval is asked again, and `park-ticket` writes a roadmap file. The record is `.company/work/<slug>/tickets.jsonl`; no Gate reads it. Contract `ticket-approval` v1 (new).
- **Automatic Lead hand-over.** Two hooks keep a long Lead session going without a manual clear. A PreCompact hook writes the Lead Handoff `lead-handoff-<n>.md` from the run records (it reads token counts from the local transcript and stores none of its text; with a Step running and tokens below the cap it exits 2 and compaction is retried on the next turn). A SessionStart hook with source `compact` injects the newest Lead Handoff after compaction. There is no PostToolUse hook. Contract `lead-handoff` v1.2 (new), ADR 0049.
- **`lead-handover base <slug> <id>`.** The Lead runs this once at Step 01 to record the run's base commit and tier, so the next dispatches after a hand-over use the recorded base. Contract `lead-handoff` v1.2 (docs/contracts/lead-handoff.md).
- **One-time setup for the hand-over.** Add `"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "98500"` to the `env` block of `~/.claude/settings.json` and restart Claude Code. See [setup](documentation/start/setup.md). Without it Claude Code compacts at its own point, not after the Lead has saved its state.
- **Idea-to-ship guide.** A new `documentation/start/idea-to-ship.md` walks the routes Water cooler, Brainstorm, Research, Spec and tickets, Park the idea, Build and Park tickets with a worked example. `documentation/commands/` and `documentation/concepts/` are rewritten in plain language; the glossary gains Idea flow, Ticket approval and Lead Handoff. The CEO-only list grows from ten to fifteen commands (`idea`, `bug`, `grilling`, `grill-me`, `grill-with-docs` added; `idea` and the three grill commands are in every company type, `bug` in `software` only). Contract `company-type` v1.7 (additive).

### Changed
- **Feature and fix no longer have a Brief or Plan Gate (breaking for runs you expect to pause).** `/aico:feature` and `/aico:fix` run from intake to build without stopping; the Ship Gate always runs and is now the only Gate, direct calls included. Fix also loses its Core or Contract Plan Gate pause. What the two Gates showed goes to the Ship Gate summary: Core and Contract changes, Art direction, plan-tasks waves, plan-check result, plan review block, spike results, the prototype answer, stale-path lines and `tickets changed since approval`. A decision that used to wait for a Gate becomes one form when it arises (a `needs-ceo` Handoff, a ruleset rule still rejected after one revision, a `plan-tasks` refusal with Fix / Stop, the prototype question, the GLOSSARY and ADR drafts); script refusals are never bypassed. Other Playbooks keep their Gates. ADR 0050.
- **Documentation by topic.** `documentation/` is now split into folders: `start/` (getting started, setup, idea to ship), `commands/` (one page per command), `concepts/`, `roles/` (one page per Role) and `mods/`. Every page has the same three sections: In short, How it works, Technical details. The old flat pages `commands.md`, `concepts.md`, `roles.md`, `mods.md`, `getting-started.md` and `idea-to-ship.md` are removed, so external links to them break. Help lines now point to `documentation/commands/<name>.md` (Contract `company-type` v1.7, unshipped amendment).
- **One fixed Context cap: `Context cap: 95000 handover 85500`.** Every dispatch carries these values for every Role and tier; the high-tier raise is gone. A missing or malformed cap falls back to the same values (a malformed one still earns the Nit). A Role hands over at 85500 with `status: handover` and starts as a fresh Step of the same Role; it asks the CEO no form and never resumes the old Step. `plan-tasks` `context:` now reads "handed over at 85500, 90% of the fixed 95000 cap". Contracts `dispatch-prompt` v4.2 and `plan-tasks` v1.3 (text fix). ADR 0047.

### Deprecated
- **`pipeline.context_cap` and `roles.<role>.context_cap`.** Still accepted and validated by `aico-settings set`, so old settings files keep working, and reported by `get` with the default 95000, but the pipeline never reads them. The settings page shows the cap as fixed text. Contract `aico-settings` v1.11 (additive). Remove them from your settings at leisure.

### Known issues
- `skills/contracts/SKILL.md` still says approved Core comes from a Plan Gate, so a fix that adds Core may be blocked by the reviewer until the CEO decides.
- After a Lead hand-over without an injected Lead Handoff, `lead-handover read` does not print the recorded base commit or tier, and the rule to use only the recorded base is written for feature and fix only.

### Data
- Your idea, bug, grill, ticket and Lead Handoff text is read by the Claude model you configured. The web search tools (WebSearch, WebFetch) run in grilling lookups and in research, and in the Water cooler and Brainstorm routes when a Role that holds them (market-researcher, tech-researcher, design-researcher, skill-researcher, senior-engineer or vuln-scanner) joins; those two routes do not forbid it, and a request can carry words from the idea. No other recipient. `grill-me` and `grill-with-docs` search nothing online. Everything else is local files under `.company/work/<slug>/`, `.company/draft-input-arg-*.txt`, `.company/ideas/<name>/` and `.company/roadmap/`. aico sets no ignore rule. Nothing is pushed or published.

## [0.22.0] - 2026-10-30

Rollback: node scripts/stable.mjs 0.21.0

### Added
- **Grill, spec and tickets.** Three commands you start yourself: `/aico:grill` interviews you one question at a time and saves `grill.md`; `/aico:to-spec` writes a spec draft (`version: pending`, never committed or stamped); `/aico:to-tickets` splits a spec or brief into a task plan. `grill` is in all four company types, the other two in `software` only. The CEO-only list is now ten commands. Contracts `grill-file` v1 and `draft-input` v1 (new), `destination-spec` v1.1 and `company-type` v1.6 (additive).
- **Feature runs take a draft.** `/aico:feature` accepts a `grill.md`, `spec.md` or `plan.md` file as its argument and works from a copy under a new task name. A plan draft is checked against the repository at the Plan Gate: a gone or newly existing path is Blocking, a changed path is shown to the Architect. Every other argument starts a run as before.
- Drafts live in `.company/work/<slug>/` and the one-shot argument file is `.company/draft-input-arg-<for>.txt`. aico never commits them. They stay out of git only if your product ignores `.company/`, which you should add to its `.gitignore` (aico does not set it up). The AI model that runs the command reads their text, and grill may run web searches built from the idea; there is no other recipient. An erasure request overrides the archive rule (the CEO decides). The argument file is removed once read.

## [0.21.0] - 2026-10-30

Rollback: node scripts/stable.mjs 0.20.0

Planned release: 0.21.0.

### Breaking
- **Contests need evidence (breaking).** `handoff` v2.0 changes three things a v1.2 producer could do. A `## Contested` line without `— evidence:` that is not an escalation is an ERROR, does not count as the finding's one contest, and the finding stays Blocking. An `## Exceptions` line in `.company/standards.md` that names no run is not applied (one warning), and a line dated before the run's latest `start` is not applied. A Handoff whose `contracts:` names `handoff` v1.x fails the cite check. Roles now write `contracts: [handoff v2.0]`. See [Migration from v1.2](docs/contracts/handoff.md#migration-from-v12) for how to move a run you started on 0.20.x and how to rewrite an exception.
- **Questions carry a reason (breaking: `reprompt` v2.0, `brainstorm-reply` v2.0).** A reprompt question line must end `— why: <reason>`. A brainstorm `Q` line must end `| why: <reason>`. A line without it is malformed. The reprompter and the brainstorm Roles ship in this release and write it.
- **Lessons carry a class and a target (breaking: `lessons` v2.0).** `lessons accept` refuses a lesson without `--class mechanical|judgement` and a `--target`. Lessons already stored stay readable and are never rewritten.

### Added
- **Fresh reviewer.** A 36th Role, Fenna (`fresh-reviewer`, Opus, high effort, never edits code). Before the Plan Gate it reads the plan as a newcomer, writes the plan in its own words, then lists what the text alone does not make clear, and only then reads the Architect's Handoff. The Plan Gate shows its paraphrase and findings. One Architect revision and one re-check at most; no new Gate. A finding that the paraphrase differs from the plan's intent is tagged `[comprehension]`, can only be fixed by changing the text and cannot be contested. Contracts `plan-review` v1 (new), `role-names` v1.4, `company-type` v1.5, `dispatch-prompt` v4.1, `tier-sets` v1.2 (additive). `fresh-reviewer` is the sixth protected Role and never runs below Opus.
- **Second reviewer (off by default).** At high risk with `pipeline.second_reviewer` `on`, the fresh reviewer also reviews the code beside the Code Reviewer. It never reads the brief or the builders' notes, never runs a third time, and stays on a Claude model: `pipeline.second_reviewer_model` is `default` or a model at or above the Code Reviewer's floor. Both settings are user level only. When the two reviewers disagree on a finding, it stays Blocking and the Ship Gate lists the disagreement. Contract `aico-settings` v1.10 (additive).
- **Evidence, escalation and rulings.** A contest cites 1 to 3 files, lines or test names the reviewer can read. If the evidence is a CEO decision or an outside fact, the builder escalates, and the finding goes to you at the next Gate. Only your own answer closes it, and it is written to `rulings.md`. States `escalated`, `upheld`, `overruled`. `handoff-lint --applied` prints every ruling and exception on file for you to confirm at each Gate. Contract `handoff` v2.0.
- **Reviews that fail are not clean.** A review Step that crashes, writes no Handoff or fails the lint is retried once, then recorded as `not run`; it shows at the Ship Gate and never counts as zero findings. A `not run` security, pentest or vulnerability lane is a Blocking Ship Gate line. Contract `review-loop` v1 (new).
- **Churn stops Fix rounds.** If a Fix round's change is followed by a new Blocking finding on the same lines, the Lead stops the Fix rounds and escalates to you with both findings. The `pipeline.fix_rounds` limit is unchanged.
- **Review evals.** Five seeded plan flaws and two seeded code flaws (one of them a tautological test) are scored with `plan-review.mjs score`; the Gate Report shows `plan review eval` and `code review eval`. They never block a release. Contract `release` v1.1 (additive).
- **Drift report.** `/aico:maintain drift` has the Architect compare a few Contracts with the code and write one dated report: missing feature, incomplete model, logic shortcut or architectural divergence, each with the doc line and code line. It blocks nothing. Without `drift` no drift Step runs. Contract `drift-report` v1 (new).
- **Right-sized plan tasks.** Each plan task carries a `context:` estimate that must fit under the Role's handover point, a `slice:` that names a behaviour a user could see from trigger to result (not a layer such as "data" or "API"), and `seams:`, the places tests attach. `plan-tasks check --handover` reports ERROR on a task that is too big, sliced by layer or without seams. Builders test at those seams, one slice at a time. Contract `plan-tasks` v1.3 (additive).
- **No tautological tests.** A test that asserts its own setup or mocks the unit under test is a Blocking `[test]` finding in review.
- **Recommended answers, early stop.** Every question to you shows a recommended answer with a one-line reason. A reprompt or brainstorm round stops asking as soon as no open question would change the result ("No open question left"); `question_rounds` stays the upper bound.
- **Lesson classes.** A lesson is `mechanical` (it proposes a script, lint or test check) or `judgement` (it goes to the ruleset or the review skill). Lessons never go to `CLAUDE.md`, `AGENTS.md` or an agent prompt. `lessons lint` checks the file.
- **Research inputs.** You can name an earlier research report as input. Roles cite it with its date and re-check or mark `(unverified)` any verdict taken from it.
- **Prototype, glossary and ADR drafts at the Brief Gate.** The Product Manager can ask one design question; you pick Run it or Skip. Run it answers the question on a throwaway branch, the Plan Gate shows the answer, and nothing from the prototype ships. The Brief Gate also lists proposed `GLOSSARY.md` entries and ADR drafts, written after you approve; a product with no `GLOSSARY.md` gets one only if you say yes.
- **Destination spec.** After the writer, the Product Manager writes `docs/specs/<slug>.md` (problem, solution, user stories, decisions, testing decisions, out of scope) with no file paths and no code blocks. `spec-check` checks it and stamps the version and date after you approve. Client projects keep it in the handoff package unless `spec_in_repo: yes`. Contract `destination-spec` v1 (new).
- **Worktrees (off by default).** With `pipeline.worktrees` `on`, parallel dispatch and a cap above 1, each builder task of a wave of two or more runs in its own git worktree in `<repo>.aico-wt`, and the Lead merges the branches in plan order, then runs the full suite once. A conflict is a Blocking finding for the owning Roles; nothing is resolved by dropping a side. Worktrees are cleaned up after ship, block or abort, and any unmerged work is saved as a patch first. Allow the folder in `permissions.additionalDirectories` first. Contracts `worktree` v1 (new), `plan-tasks` v1.3.
- **Ship Gate guardrail lines.** Two lines show how many paths were swept across tasks and how many Steps handed over. A prototype commit in the run branch is a Blocking Ship Gate line. They never block otherwise. Contract `run-guard` v1 (new).
- **Version on the status line and the ready toast.** The mods status line starts with `v<x.y.z>` and the toast reads `aico <x.y.z> mods ready: …`. Contract `aico-mods` v1.4 (additive).

### Changed
- The settings page has rows for Second reviewer, Second reviewer model and Worktrees. The Short path hint now lists the plan review among what a short path skips.
- The model floor file holds six protected Roles.
- Rollback: set `pipeline.second_reviewer` and `pipeline.worktrees` to `off` in `/aico:settings`. The plan review has no setting; `pipeline.short_path` `on` skips it for low-risk work.

### Fixed
- **Re-begin after a Fix round.** `plan-tasks.mjs begin` now starts a new segment at round 0, so plan tasks left pending when a Fix round started are offered again by `next`, `lines` and `brief`. Before, the record stayed in the Fix round and those tasks could only be dispatched by hand, without a task brief. A `round` event now starts its round with an empty done list, since a round number can repeat after a re-begin. Contract `plan-tasks` v1.1 (fix note; record format unchanged).

## [0.20.0] - 2026-10-29

Rollback: node scripts/stable.mjs 0.19.1

### Added
- **Hook Gate.** `plan_check.policy` `block`: the scripts refuse the Plan Gate record, the build start and every task start while the plan has open decisions. A project can raise the policy to `block` but never lower a user `block`. Under `warn` and `off` nothing changes. Contracts `plan-check` v1.2, `plan-tasks` v1.2, `run-state` v1.5, `aico-settings` v1.9 (additive).
- **Judging diff.** Reviewers get the diff from the full base commit (40 or 64 hex) to the run branch. A git grafts file stops every judging check. Binary is decided by file content; a binary file outside the fixed type list in a text path blocks until fixed or excepted by you; binary-marked text files are shown through `rule-check text`. Contracts `tier-sets` v1.1, `rule-check` v1.1, `review-depth` v1.1, `dispatch-prompt` v4.0.
- **Contested findings and receipts.** Every reviewer finding has an ID `<NN>-<role>:R-<n>` and can be contested; a security finding never closes by contest. `token-ledger` gets a `receipt` command. Contracts `handoff` v1.2 (additive), `token-ledger` v1.5.
- **Cost from telemetry.** The scorecard shows a cost segment only when one is recorded in your OpenTelemetry export file. It is Claude Code's approximate cost, not a bill. Contract `cost-source` v1. See [concepts](documentation/concepts.md#cost-from-telemetry) for the setup.
- **CEO question pack, never-cited report, first product.** Contracts `cited-report` v1 and `project-init` v1.
- **Releases.** An SBOM, a `Rollback:` line and a Gate Report per release. Contract `release` v1.
- **Other new Contracts.** `qa-timing`, `step-times`, `contract-index`, `plugin-root`; `rule-pack` v1.2.
- **SECURITY.md** with private vulnerability reporting.

### Changed
- **Names only for the CEO.** A Role gets no `Name:` line (breaking: `dispatch-prompt` v4.0) and writes its Role id in its byline. Names show only to you. Brainstorm files store Role ids (`brainstorm-file` v2.2, `role-names` v1.3, `reprompt` v1.2).
- The documentation lists the checks' residual risks under Residual risks in `documentation/concepts.md`.

## [0.19.1] - 2026-10-28

### Changed
- **Goldfish builders.** A plan-task builder now gets a task brief instead of the whole plan: `plan-tasks.mjs brief <slug> <id>` writes `.company/work/<slug>/tasks/<id>.md` with the task's own block, the plan's Contract sections, the plan-wide `Decided:` lines and the sections that name the task, and prints one `Task brief:` line for the dispatch. Such a builder still reads the Architect's Handoff, but reads the brief in place of the plan and never opens the full plan; a gap returns `blocked` with `missing plan context`. `U1`, tasks without a plan block and plans with an unclosed fence keep the old route. The brief file is written without following links and its open handle is checked before it is rewritten. Contracts `plan-tasks` v1.1 and `dispatch-prompt` v3.6 (additive).
- **Goldfish first pass for reviewers.** The code reviewer and QA first judge the diff against the brief's acceptance criteria, the plan and its Contracts, and write those findings before they read any builder Handoff. They then add or withdraw findings and name each change. A builder's own claim never closes a first-pass finding.

## [0.19.0] - 2026-10-28

### Added
- **Short path for low-risk work.** For `aico:feature` and `aico:fix`, `scripts/tier-set.mjs` picks the Roles and lanes per tier from the plugin data file `company/tier-sets.json`. At low, a feature skips the persona tester, ruleset research, and the security, compliance and hands-on lanes; a fix skips the security lane. Medium and high keep the full route. `legal` and the accessibility tester stay at every feature tier. Every Gate, the test per acceptance criterion, the fix regression test, the full suite, the reviewer pre-filter and the Handoff lint are unchanged. Contract `tier-sets` v1 (new), ADR 0034.
- **Tier only rises.** The run tier is the highest of the triage tier, any Step's tier and a path check. Contract files, Core paths, `.company/project.md`, `.company/settings.json` and `.company/standards.md`, paths with auth, payment, personal-data or migration names (whole words), and a check that cannot be answered force high. The check reads file names, not content. A short run that is raised shows `add before ship:` and those Roles run before the Ship Gate.
- **Brief Gate options.** For a low feature the form lists what would be skipped and offers Approve, short path (Recommended) or Approve, full path. The short path needs your explicit "Approve, short path"; an auto Brief Gate and a missing choice mean full. Brief, Plan and Ship Gate summaries of feature and fix runs show the path lines.
- **Fix triage record.** `/aico:triage` also records a bug at risk low routed to `aico:fix`, and `triage check --route fix` proves it. Without that record a fix starts at medium. A low fix takes the short path only from that trusted record while `gates.brief` is `ask`. Contracts `run-state` v1.4 and `company-type` v1.4 (additive).
- **Short path setting.** `pipeline.short_path`, `on` or `off`, default `on`, with a row on the settings page. A project can only turn it off; off wins. Contract `aico-settings` v1.8 (additive).
- **Run record.** `.company/work/<slug>/tier-path.jsonl` holds enums, whole numbers, a commit sha and UTC times. The ledger gets `meta.pb`, `meta.sets`, `ship.path` and `ship.raised`, and the scorecard shows `path short`. Paths found by the check are shown, not stored. Contract `token-ledger` v1.4 (additive).
- **Low-path verdict.** `/aico:feedback` quotes two lines from `ledger.mjs low-path-verdict` under `## Low path`: `pass`, `fail` or `insufficient (n=<k>)`, for feature and fix. It never blocks a Step or a Gate. The parallel verdict and the plan-check verdict leave short runs out (`plan-check` v1.1, additive).

### Changed
- If the data file is refused, or a script step fails, both Playbooks use the high set. A change never makes a run shorter.
- What a short run skipped is fixed at `begin`. If the data file is refused later or its `rev` changes, the run goes to high and the skipped entries come back.
- The script's git calls ignore replace refs. The base is the full-length commit id of the repository's object format and an ancestor of HEAD; each check uses the Lead's own base, which must equal the recorded one, else the check counts as unanswerable (high).
- Rollback, in order: set `pipeline.short_path` to `off` in `/aico:settings`; then change the data file in a release with a new `rev`.

## [0.18.0] - 2026-10-28

### Added
- **Capped parallel plan Steps.** The Architect marks each plan task with `role`, `files`, `depends-on` and `parallel` lines. `scripts/plan-tasks.mjs` decides which tasks start: only marked tasks run together, tasks that share a path run in plan order, and any other task runs alone with a warning. At most `pipeline.parallel_cap` Steps run at once. The Plan Gate shows a Parallel plan block that never blocks the Gate. Each plan-task Step gets `Task:` and `Files:` lines; a path edited outside `Files:` is counted, and one that belongs to another running task is not committed. Contracts `plan-tasks` v1 (new), `dispatch-prompt` v3.5 (additive), ADR 0033.
- **Parallel cap setting.** `pipeline.parallel_cap`, a whole number from 3 to 5, default 4 (a bad stored value falls back to the level below: your user value, else 4), with a row on the settings page. Dispatch `sequential` overrides it with 1. Contract `aico-settings` v1.7 (additive).
- **Parallel verdict.** `ship` writes one `par` ledger line of four whole numbers (cap, peak, overlap waits, out-of-list paths). `/aico:feedback` quotes one `parallel verdict:` line from `ledger.mjs parallel-verdict`: `pass`, `fail` or `insufficient (n=<k>)`. It never blocks a Step or a Gate. Contract `token-ledger` v1.3 (additive; the model verdict's v0.17 side now ends before 0.18.0).
- **Run record.** `.company/work/<slug>/parallel.jsonl` holds task IDs, repo paths, the plan file name, a plan hash, the cap, the mode and UTC times, with no Handoff, plan or CEO text, and stays with the run's Handoffs.
- **Shared-tree rule.** Roles on a plan-task Step change only the paths in `Files:`, never use `git stash`, and never kill processes by name.

### Changed
- The pipeline rule "Parallel by default" is now a capped rule driven by the script.
- Rollback: on a `fail` verdict set `pipeline.parallel_cap` to 5 in `/aico:settings`; when the cap already is 5, set `pipeline.dispatch` to `sequential`.

## [0.17.0] - 2026-10-28

### Added
- **Model floor.** `company/model-floor.json` holds each Role's v0.16.0 model as its floor and lists the protected Roles: architect, code-reviewer, pentester, security, vuln-scanner. A high-tier run dispatches no Role below its floor, and the `Settings:` line ends with `floor` when the Lead raised the model. A protected Role ignores a lower stored model at every tier, with a warning. Contracts `aico-settings` v1.6, `dispatch-prompt` v3.4 (additive), ADR 0031.
- **Model environment line.** `settings.mjs model-env` prints one line when `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set, with the Claude Code version and whether the floor is kept or bypassed.
- **Model verdict.** `/aico:feedback` quotes one `model verdict:` line from `ledger.mjs model-verdict`: `pass`, `fail` or `insufficient (n=<k>)`, with the Roles to roll back on `fail`. The `ship` step writes a `meta` record with the plugin version. Contract `token-ledger` v1.2 (additive), ADR 0032. It never blocks a Step or a Gate.
- **Description budget.** `npm run check` estimates agent description size, fails a Role over 400 tokens or a total of 15,000 or more, and prints the total and headroom.
- **Settings page.** Protected Roles show a hint on the Model controls.

### Changed
- **tech-researcher** runs on Sonnet (was Opus). Rollback: set `roles.tech-researcher.model` to `opus` in `/aico:settings`, or install the `stable` v0.16 tag.
- A stored model below a protected Role's floor no longer applies.

## [0.16.0] - 2026-10-28

The Plan Gate lists choices a plan left open.

### Added
- **Plan check.** At each Plan Gate the Lead scans the plan's sections headed Steps, Tasks, Wave, Phase, Fix round, `T<n>` or `M<n>` for `TBD`, `TODO`, `decide later` and open either-or questions, and shows up to 5 rows `file:line | phrase | why` plus `+<k> more`. It is text-only, uses no model and in this version never blocks a Gate. Policy `off`, `warn` (default) or `block`; `block` makes the script exit with an error code on a finding, and the Plan Gate still treats it as `warn`. You can mark warnings as noise in the Plan Gate form. Patterns live in a capped file of at most 10 entries. Contract `plan-check` v1, ADR 0030.
- **`Decided:` lines.** A settled choice gets its own line `Decided: <choice> because <reason>`; the check skips it and counts it. When an open plan choice shows up in review, the reviewer adds an `[open-decision]` Nit; a real bug it caused stays Blocking.
- **Per-run record.** `.company/work/<slug>/plan-check.jsonl` holds counts, enums, the plan file name and times only: no plan text, no phrase, no CEO text. It stays with the run's Handoffs: committed only where the product tracks `.company/work/`, otherwise local. The ledger and Handoff frontmatter are unchanged.
- **Verdict and history scan.** `/aico:feedback` quotes one `plan-check verdict` line: `pass`, `fail` or `insufficient (n=<k>)`, comparing median Fix rounds of check-on runs with earlier runs, plus the waved-off share. The check is not shown to reduce Fix rounds until the verdict says `pass`. `plan-check-verdict.mjs history` scans past plans in the working tree and in git history, read-only, and writes nothing.
- **Settings.** Plan check table on the Pipeline tab: `plan_check.policy` (default `warn`) and `plan_check.runs` (3 to 50, default 5). Contract aico-settings v1.5 (additive).

### Changed
- **Fix rounds count.** The `fix_rounds` in the `ship` record counts Steps before your first Ship Gate answer.

## [0.15.0] - 2026-10-28

Runs get a scorecard, and releases get a safe rollback ref.

### Added
- **Run scorecard.** After you approve the Ship Gate, one line shows the run's time to Ship Gate, your wait at Gates, spend tokens per shipped AC, Fix rounds, high blockers and Gate rejects, each beside the median of the last 5 shipped runs. Brainstorm, replay, baseline and untimed runs are left out and counted. It only reports and never blocks a Step or Gate. Times are UTC and counts only. The ledger stays in the repository, is committed with the run only when the product tracks `.company/` (otherwise it stays local). It holds only counts and times, no prompt or reply content, and it leaves your machine only when a branch that holds it is pushed. Contracts `token-ledger` v1.1 and `run-state` v1.3 (additive; v1 ledgers read the same), ADR 0028.
- **`stable` branch.** `npm run stable -- <x.y.z>` moves `stable` to a merged, annotated release tag. Getting started shows how to follow `stable` or install one earlier tag. ADR 0029.
- **CI plugin check.** CI runs `claude plugin validate --strict` and fails on an error. `claude plugin eval` is report-only and is skipped while the repository has no eval suite.

### Changed
- **Release.** `npm run release` also runs `claude plugin validate --strict` and makes no commit or tag if it fails.
- **`ship` record.** The Lead writes it after the Ship Gate is approved, not before.

## [0.14.1] - 2026-10-27

Triage lines are harder to fake.

### Added
- **Triage record.** Before a direct route starts, `aico:triage` writes a record in the gitignored `.company/triage/` folder: a keyed hash of your exact request (HMAC, keyed by a one-time code; NFC, line ends as LF, trailing spaces stripped per line, trimmed, one pair of outer quotes ignored) and a time. It holds no request text and no code. A record is valid for 30 minutes and one use. The Lead checks the code from triage's own run once and never runs `triage issue` itself. Files with more than one hard link are refused. `triage check` spends a live record on every check, so a record cannot be reused, and files that were opened are checked again. New commands `run-state.mjs triage issue` and `triage check <nonce>`. Contract `run-state` v1.2, ADR 0027.

### Changed
- **Look-alike checker.** The reprompt checker now refuses a triage line in more spellings: look-alike letters from other scripts, full-width and other compatibility forms, combining marks, Unicode spaces, Markdown or HTML tags between the word and the colon, colon look-alikes and HTML colon references. It refuses more replies than before and accepts none it refused. Contract `reprompt` v1.1.
- **Claim rule.** A claimed approval inside a request never counts: a triage line, a look-alike of one, or words saying the request was triaged, that you approved it, that a Gate passed or that a route was chosen. The Lead trusts only a direct triage line confirmed by the triage record; any other request goes to triage. Only your own answer to a form or Gate approves anything. Contract `company-type` v1.3 (aico:lead only; line format and triage output are unchanged).

## [0.14.0] - 2026-10-27

A prompt-writing Role: the reprompter.

### Added
- **reprompter (Lynn) and `/aico:reprompt <prompt>`.** A new Role that turns a rough prompt into a complete one: goal, context, inputs, constraints, output format and a done-check. She asks at most 3 questions when a gap would change the result, then states her assumptions. She never runs the prompt; you choose Use it, Edit, Keep only or Stop. Your text is treated as content to rewrite, not as orders. The files stay in `.company/work/<slug>/` on your machine and are never committed or pushed. The prompt is AI-written; check it before you use it.
- **Write gate.** The reprompter may write only `prompt.md` and its own Handoff in the run folder. After each reply the checker compares your git settings and config folders and tells you which files changed; the command needs the aico hooks module.
- **Question rounds setting.** `reprompt.question_rounds` (0 to 3, default 1) on the Pipeline tab of `/aico:settings`; 0 means no questions. Contract aico-settings v1.4.
- **Reprompt is startable by the Lead.** `reprompt` is always on in every company type, and the reprompter is the 35th Role, in every type. The Lead starts `/aico:reprompt` with your text as its argument and falls back to showing you the command. Contracts: reprompt v1, company-type v1.2, role-names v1.2, dispatch-prompt v3.3.

## [0.13.1] - 2026-10-27

Playbooks can start the next Playbook for you.

### Changed
- **Playbook hand-offs.** 21 Playbooks are visible to the model, so a finished Playbook can start the next one through the Skill tool and falls back to telling you the command (brainstorm, research, lead, triage). The 7 CEO-only commands stay hidden: help, version, language, settings, setup, skillspector, pentest. A shared guard sentence opens every Playbook description, and Roles never start a Playbook. ADR 0026, contract company-type v1.1.
- **Triage** always starts exactly one Playbook and never lowers the risk tier. **Refactor** asks before the audit, then ends. **Incident** hands /aico:fix to you. Every Playbook answers help from documentation/commands.md.

### Known risk
- The guard is text only. Injected text could start fix or standards (a local branch and commits); with a Ship Gate you unlocked, an unasked run could push and open a PR. A hard guard hook was declined and is recorded as Debt.

## [0.13.0] - 2026-10-27

Company types, personalities, a new editor Role and a redesigned settings page.

### Added
- **Company types.** A project has one type: `software` (default, unchanged), `research`, `marketing` or `design`. The type sets which Roles and Playbooks the project has and what "ship" means. `/aico:setup` (argument `type`, or no arguments) asks which type, saves `company_type:` in `.company/project.md` only after you answer, and then offers a skill search for the type (at most 5 picks, each scanned first; nothing installs without your answer). Switching a type later is not supported. For types other than `software`, the Ship Gate summary starts with `Ship means: …` and checks must pass: `claims-cited`, `ai-disclosure`, `asset-licences`, `handoff-package`. Lanes are forced on: legal for research; legal and accessibility for marketing; legal, accessibility and security for design. A command or Role outside the type is refused with the allowed list, and `/aico:help` lists only the type's commands. Contract `company-type` v1, ADR 0022.
- **New Playbooks:** `/aico:report` (research), `/aico:campaign` and `/aico:content` (marketing), `/aico:design` (design).
- **editor (Edith).** A new Role, the 34th. It checks every claim is cited `[S#]` or marked `(unverified)` and blocks with `[spec]`; it never rewrites. It has no Bash and no web access.
- **Personalities.** Each Role has a temperament, a way of talking, a pet topic, and an Intelligence and a Creativity level (`low`, `medium` or `high`). They colour a Role's voice in `/aico:cooler` and `/aico:brainstorm` only, as quoted style data, and never change a verdict, review, Gate or other dispatch. Project values count without an unlock. Text is 1 to 80 characters of letters, digits, spaces and `, . ' - ! ?`; a bad value is ignored with a warning that does not repeat it. Personalities are not in `settings.mjs get`. In a first test the block changed the tone of brainstorm replies without lowering the parse rate; Creativity showed in how far ideas reached, and Intelligence showed little under the 80-word cap. Contracts: `role-names` v1.1, `aico-settings` v1.3, `dispatch-prompt` v3.2, `brainstorm-file` v2.1. ADR 0021.
- **Settings page.** A Personality tab (after Roles), one collapsible card per Role with User and Project fields, an "n of 80 characters" counter, and the sentence the Role is told for each level. A Filter Roles box hides cards by name, Role or department; it never changes what is saved. A refused Save shows "Nothing was saved. Fix n field(s):" at the top with a link to each field.
- **Plan Gates for `/aico:report`, `/aico:campaign` and `/aico:content`.** Report: outline, researcher questions and source plan. Campaign: positioning, channel plan and deliverables. Content: the outline. Each is approved before research or production.
- **Readable company-type output.** `company-type.mjs` prints plain lines by default (`company type:`, `roles:`, `playbooks:`, `work:`, `ship:` and more); `--json` gives JSON. Refusals name the bad input. New `work` key per type and a `pick` command so shared Playbooks reach a stand-in Role. `.company/` and `project.md` are read through links. Contract `company-type` v1, ADR 0023.

### Changed
- **`ai-disclosure` wording (marketing and design).** Legal now states, for each AI-generated public image, video or text, which AI Act art. 50 duty applies and how it is met, or why none applies, plus `deepfake: yes` or `no`; a run with no AI assets states `none`. The legal lane for campaigns and content now also covers testimonials and reviews, advertising labels, price and green claims (Directive (EU) 2024/825, from 27 September 2026) and comparison limits (Directive 2006/114/EC). The design package carries each asset's AI flag, tool, prompt and date, and an ownership note. These checks record Legal's statement; they are not legal advice or a compliance certificate.
- **Personality text rule.** Each word starts with a letter or digit; invisible characters and modifier letters are refused. `role-names` v1.1.
- **Settings page redesign.** New layout, type scale, colours for light and dark mode, tabs, tables and focus styles. Tabs, labels and settings are as before. A refused Save saves nothing and focuses the error summary.
- Role count is 34 in the README, the documentation and `plugin.json`.

## [0.12.0] - 2026-10-27

Skill picks you can trust, a scanner for the skills you already have, and progress bars in the Savvy pane.

### Added
- **skill-researcher (Selin).** A new Role that finds and vets third-party skills for four areas: `stack`, `product-type`, `company-type` and `design`. It recommends at most 5, ranked by fit and evidence. It has no Bash and runs no scanner: the Lead scans each pick in a quarantine folder before you see it, and the Role's own scan claims count for nothing. A critical or high finding, a failed scan or a timeout rejects a pick; with no scanner installed nothing is recommended. You approve the set in one form and confirm the exact install commands in a second. Nothing installs unless both are yes. The install pins the commit that was scanned. The Lead scans only the folder the skills CLI will install, and refuses a commit that is not in the repo (such as a fork commit) and a candidate with a link or submodule. After the install it compares the hash the skills CLI recorded for the skill folder it installed with the hash of the scanned folder, then scans the installed skill again; a mismatch, a missing result or a bad scan stops the run and shows you the removal command. It removes nothing itself. A pick with only a command source cannot be pinned, so it cannot be approved.
- **`/aico:skillspector [--project|--global|--all|<skill-name>] [--no-llm|--claude-cli] [install]`.** With no scope, or more than one, a form asks: Project (Recommended), Global or All. Scans the skills installed in this project or your user folder with NVIDIA SkillSpector and reports pass, findings or error per skill, in `.company/work/<slug>/skillspector-report.md` (names, verdicts and counts only, never skill text). It is read-only: it suggests removal commands and runs none. An error is never shown as safe.
  - **Pinned install.** The install form names the release v2.13.1 and runs two commands, in this order: `uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git@v2.13.1'` and `claude mcp add --scope user skillspector -- skillspector mcp`. Both change your user-scope Claude config. Rollback: `uv tool uninstall skillspector` and `claude mcp remove --scope user skillspector`. It always asks, whatever your Gates say, and aico never installs `uv`. Installing from the unpinned `main` branch would be a supply-chain risk, so it is not offered.
  - **Scan mode setting.** `skillspector.mode` in `/aico:settings` (Skill scan tab) is `no-llm` (default; static rules on your machine, no skill text leaves it; package names, versions and ecosystems from a skill's dependency files go to OSV.dev for a vulnerability lookup, plus the ids of any vulnerabilities found) or `claude_cli` (the OSV.dev lookup also happens). `claude_cli` sends the text of each scanned skill to Anthropic through your `claude` login and counts toward your usage, so it counts only from your user settings and the command says so before it scans. The flags `--no-llm` and `--claude-cli` override it for one run.
- **`## Skills` project section.** Approved `stack`, `product-type` and `company-type` skills are recorded in `.company/project.md` under `## Skills`, one line each. Design skills stay under `## Design skills`. The project template has the new section.
- **Savvy progress bars.** The pane shows `Gates 1/3 [###-----] last: brief` and `Steps 5/8 [#####---]`, with the count first. They are plain ASCII, always show the numbers and fit panes from 10 to 400 columns wide. An unreadable value shows `?` with no bar. A shipped run shows both bars full. The status line is unchanged.
- **Contracts:** `skillspector-scan` v1, `skill-recommendation` v1 and `skills-section` v1 (new); `aico-settings` v1.2 and `aico-mods` v1.1 (additive). ADR 0018.
- README: installation steps and how to change settings.

## [0.11.0] - 2026-10-26

Cheaper brainstorms and cheaper runs. The savings come from reading less (shorter prompts, fewer reads, fewer dispatches). Brainstorm Roles now keep one constant prompt, so it can be cached. No saving percentage is claimed yet.

### Added
- **Mods.** Four add-ons inside Claude Code, all on by default and switched in `/aico:settings` (Mods section); see `documentation/mods.md`. **Savvy** shows run progress. **Cache Tax** shows spend per Step and the cache clock: when the Lead's cache expires, with a note that subagent caches last 5 minutes. **Reflect** checks each Step and the finished run and suggests Lessons; each needs your Accept, and `model` mode (off by default, user level only) spends tokens that are ledgered as `reflect`. **Blast Radius** checks a `git commit` before it runs, through both the `Bash` and `PowerShell` tools: `core: ask`, `security: ask`, `contract: warn` by default; with nobody to ask (plain `claude -p`) it refuses the commit with a reason. The mods share one status line. Terminal is proven; desktop is unverified and shows `unknown` where scripts cannot run.
- **Run-state** (`scripts/run-state.mjs`): the Lead records each run's wave, Gates and end. It never blocks a Step or a Gate.
- **Mod settings** (`mods.*`) with three locks: Reflect `model` is user-level only; a project can only tighten Blast Radius; `security: warn` and switching Blast Radius off need the `security` unlock. There is no keep-warm key.
- **Contracts:** `aico-mods` v1, `run-state` v1, `reflect` v1, `lessons` v1; additive changes to `token-ledger`, `review-depth` and `aico-settings`. ADRs 0015 to 0017.
- **Brainstorm format 2.** New files have `## Summary`, `## Digest`, `## Questions` and `## Rounds`. The digest quotes your answers word for word, lists open threads and keeps a dissent line in the Role's own words. Questions are queued: duplicates merged with votes summed, answered ones never asked again, blocking first. A skipped question records its default as "CEO skipped". Roles can reply to an idea (`@Role on I-2.1: agree | challenge | build-on`), may skip a round, and answer in about 100 words. Each Role gets one constant dispatch prompt for the whole run plus a per-round input file in `.company/brainstorm-input/` (written by the script, removed at Close) with the digest, the questions already asked and answered, and up to five "Others said" headlines with idea IDs. Answered questions are merged, not asked again. The Architect adds an S/M/L estimate per round. Files without `format` open and continue as before and are never rewritten.
- **Crossfire.** In debate mode the sharpest clash is folded into the next round: the challenged Role answers it in its next ideas pass, with no extra dispatch. `brainstorm.debate` is `crossfire` (default) or `full_pass`, which keeps the live pair and the full second pass.
- **Shorter brainstorm replies and input files.** The Lead asks for at most 80, 55 and 40 words (ideas, full, crossfire). The input file drops the digest and shows "Your last ideas" as plain lines without IDs or labels. A reply with a copied idea ID or bullet before a label is accepted, not re-asked.
- **Builder rule slices.** Builders get a per-task file with their rules in `.company/work/<slug>/rules/<task>.md` (`rule-check slices --write`) instead of the full ruleset map.
- **CEO rulings without a question.** A ruling that answers no asked question is stored word for word as its own decision (`decide`), no longer attached to a nearby question. A brainstorm Lead summary that says `Open:` must name a question or open thread, or say `Open: none`.
- **Review Handoffs.** A `read_next` pointer may be `path#heading` with spaces in the heading, and a continued review appends its new findings to the findings file.
- **Film script** (`brainstorm.film_script`, off by default): a separate file written by the script with no model call, every line quoting a stored reply.
- **Max context** (`context_cap`) in `/aico:settings`: global plus per Role, default 150000, minimum 60000. Roles hand over at 80%. High-risk work is never below the default.
- **Token ledger** (`scripts/ledger.mjs`): counts only, per Step and per run, in `.company/ledger/`. One cost line at the Ship Gate; `/aico:feedback` compares the last three runs.
- **Review format** (`pipeline.review_format`: `plain` or `pilot`, default `plain`) in `/aico:settings`. With `pilot`, the code-reviewer and compliance Steps write an `aico-top` block, findings as `ID | file:line | problem | why | fix` rows with stable IDs, and a findings ledger on handover, checked by `scripts/handoff-lint.mjs`. Other Roles are unchanged. Tested on 3 re-reviews each way, both modes pass; `pilot` cost about 5.7k more tokens per re-review than `plain`, and no saving is claimed. Rule slices for builders and search-then-read stay on with `plain`.
- **Tool checks bound by rule ID** (`scripts/rule-check.mjs`, `.company/checks.json`): a failing check becomes a finding the reviewer confirms before it blocks. Rule slices always include every security Must. With `pipeline.review_format: pilot`, a findings ledger, written only near a handover, survives a handover mid-review. Review depth follows the touched paths (`scripts/review-depth.mjs`).
- **Golden Handoffs and a regression set** of past high-tier fixes, both under `npm test`.
- **`npm run release <x.y.z>`**: bumps every version field, rolls this section, runs the checks, makes one local commit and tag. It never pushes.
- **Rule-pack checks** in `scripts/check.mjs --packs <dir>`: a bad format, a pack older than 90 days or a new advisory fails. CI on committed copies fails at 180 days.
- **Contracts:** `handoff` v1.1, `dispatch-prompt` v3.1 (`Context cap:`, `Review depth:`), `aico-settings` v1.1, `brainstorm-file` v2, `brainstorm-reply` v1, `token-ledger` v1, `rule-pack` v1.1, `rule-check` v1, `review-depth` v1. ADRs 0007 to 0012.

### Changed
- **Pipeline dispatches** carry `Context cap:` and, for the code-reviewer, `Review depth:`. `scripts/check.mjs` fails a dispatch block without `Context cap:`. No Playbook is exempt: research prompts carry it too; only brainstorm and cooler, which write no Handoff, have no such line.
- The commit lines in the pipeline and brainstorm Playbooks check paths and names before any shell command.

## [0.10.0] - 2026-10-26

A settings page, a name for every Role, and an effort level per Role. The pipeline now applies your settings when it dispatches.

After updating, run `/reload-plugins`. Settings are optional: nothing changes until you save something.

### Added
- **`/aico:settings`** — opens a local page (a small server on 127.0.0.1, protected by a token in the link) to set each Role's name, model and effort; language and profile; the pipeline (Fix-round limit, parallel or sequential dispatch, optional lanes); and the Gates (ask or auto). Set it as your default (`~/.mcsparrow/config.json`) or as a project override (`.company/settings.json`); the project wins. Ship, installs and the security lanes can only be unlocked from your default. The page stops when you press Done, or after 30 minutes idle. `node scripts/settings.mjs get <key>` prints a resolved value.
- **Role names.** Every Role has a person name (`company/names.json`, for example Ava for the architect), which you can change per level in the settings page.
- **Contracts and decision:** `aico-settings` v1, `role-names` v1 and ADR 0006 (settings resolve in a script and travel in the dispatch).

### Changed
- **The pipeline reads settings.** Setup resolves them once per run; each dispatch passes `model` and `effort` to the Role and carries `Name:` and `Settings:` lines (`dispatch-prompt` v3). Gates, Fix rounds, dispatch mode and optional lanes follow your settings. With nothing set, behaviour is as before.
- **Names are shown.** Scripts, the cooler and brainstorm, Handoffs, Gates and `/aico:help` show a Role's name with the Role. The Lead routes by name only when the name is used as a person.
- Every Role now sets an `effort` level. **High:** architect, code-reviewer, security, pentester. **Low:** writing, art, lookup and support Roles. **Medium:** the rest. `scripts/check.mjs` fails an agent with no `effort` or an invalid one.
- Model changes: writer haiku → sonnet, because user-facing docs need it. vuln-scanner and design-researcher opus → sonnet, because their work is lookup against fixed checklists.

## [0.9.0] - 2026-10-22

Research before you build: three researcher Roles look a topic up online before work starts, and the Product Manager turns the findings into one sourced report. Also a language setting for aico's own output.

After updating, run `/aico:setup` (it installs the `research` skill group) and `/reload-plugins`.

### Added
- **`/aico:research <topic | project | file> [quick|deep]`** — a read-only Playbook. One form approves the research question, the depth (default deep) and the Roles. The researchers search in parallel, and the Product Manager writes one report: `## Verdict` (go, go-with-conditions or no-go, with confidence), `## What to do` (ranked), `## Low-hanging fruit` (impact and effort), `## Risks`, `## Open questions` and `## Sources`. Every claim cites a source with its URL and check date. A claim without a source is marked `unverified` and cannot back the verdict. The report goes to `.company/research/YYYY-MM-DD HH.MM - <Topic>.md`, labelled AI-generated research. Then you pick: start `/aico:feature`, brainstorm, roadmap or park. Only the report is committed, and nothing is pushed.
- **Three Roles:** `market-researcher` (demand, competitors, target users, pricing signals, EU flags for legal), `tech-researcher` (feasibility, libraries and APIs, licenses, fit with the repo, effort and risk; it reports facts and never picks the stack) and `design-researcher` (finds and vets UI/UX skills against your stack, Personas and Art direction; recommends at most 5). Researchers write only their own Handoff and never install anything.
- **Design skills.** `## Design skills` in `.company/project.md` records the approved set: name, source, license, vetted and approved dates. `/aico:feature` runs the design-researcher for a UI product when the set is empty or older than 180 days. Installs run only after you approve the exact commands in a form.
- **`/aico:language [<tag> [project] | clear [project]]`** — the language aico writes in: Handoff prose, forms, reports, summaries and commit summaries. Your default is stored in `config.json` under `~/.mcsparrow/` (or `MCSPARROW_HOME`). A project override is the `aico_language:` line in `.company/project.md`. With neither set, aico writes English, as before. Machine-read parts stay English in every language: frontmatter, headings, status values, blocking tags, file and folder names, commit types.
- **`research` skill group** in `deps/skills.json`: `find-skills` (MIT), included in `core`. aico uses it for guidance only; the search itself uses WebSearch and WebFetch.
- **Checks in `scripts/check.mjs`:** the Role count in the plugin description and docs, every agent listed in `documentation/roles.md` and the spec roster, a `/aico:<name>` entry in `documentation/commands.md` for every Playbook, `Language:` in every dispatch block, and the name and source patterns of skill manifest entries.

### Changed
- **Roles: 29 to 32.** The three researchers join the company. The hierarchy has a "Market & tech research" department, separate from "User research & testing".
- **Dispatches carry `Language:`.** The pipeline resolves the language once per run and passes it to every Role, including the Playbooks that skip pipeline setup (brainstorm, cooler, research, triage, help).
- **`/aico:brainstorm`** accepts a research report. Its close form gains "Research it first".
- **`/aico:lead` and `/aico:triage`** route research, feasibility and quick-win questions to `/aico:research`.
- **Five UI Roles** (ui-ux-designer, frontend-engineer, desktop-engineer, game-engineer, brand-artist) load the approved design skills from their dispatch. A skill that is not installed is named under `## Next`.
- **Development:** `npm test` runs every `scripts/*.test.mjs`. The repo targets Node 24 (`.nvmrc`, `engines`). CI runs with read-only token permissions and pinned action commits. Skill installs need Node 22.20 or later. Text files are stored with LF line endings (`.gitattributes`).

### Fixed
- **Report names are checked before use.** A topic with anything but letters, digits, single spaces or hyphens, or longer than 5 words or 60 characters, is not used. The report is named with the run slug instead, and the commit is made only from the checked name.
- **Presence check stops cleanly on error.** If the install check fails, `/aico:research` shows the error, installs nothing, asks no form and continues on WebSearch and WebFetch.
- **Design-skill dates use your local day.** Dates in `## Design skills` are checked against the local calendar, not UTC, so today is accepted and tomorrow refused in every time zone.
- **Plugin script paths are quoted.** Commands run `node "${CLAUDE_PLUGIN_ROOT}/scripts/…"`, so they work when the install path contains spaces. Skill installs off Windows run `npx` without a shell.

### Rollback
A design-skill install in a product adds `.agents/skills/`, `.claude/skills/<name>` and `skills-lock.json` in that product's repo. To remove a skill, run `npx -y skills@1.7.4 remove <name> -a claude-code` in the product root, then delete its line under `## Design skills`. impeccable uses its own installer, and its uninstall path is not verified.

## [0.8.1] - 2026-10-22

### Fixed
- **The cooler chat reads like a movie script.** A `# THE WATER COOLER` title and logline, `### SCENE n — INT. OFFICE KITCHEN, BY THE WATER COOLER — NIGHT` headings (later `SAME — CONTINUOUS`, `MOMENTS LATER`, …) split by subject with `---`, an italic action line per scene, capitalised speaker cues with the line as a quote and optional `*(parentheticals)*`, walk-ups, walk-offs and passes as action lines, and `**FADE OUT.**` at the end. Every element is its own block, so Markdown no longer runs the chat into one paragraph.
- **Overheard is saved in the file, not shown on screen.** One bullet per idea, problem, worry or question, with who raised it. The terminal gets only the file path, the number of turns and who was there.

## [0.8.0] - 2026-10-22

### Added
- **`/aico:cooler [topic] [turns=N | listen]`** — an unmoderated water-cooler chat. 2–3 random Roles talk about the project (the topic, or something on their mind), one line at a time; random colleagues walk up and others leave (2–5 at the cooler). Ends when everyone passes or at 20 turns (default), after N turns, or when the CEO stops it in `listen` mode, where the CEO can also chime in. Recorded in `.company/cooler/YYYYMMDD-HHMM-<topic>.md` with an "Overheard" list at the top; nothing is built or routed. `/aico:brainstorm` accepts a cooler file as its idea.
- **`/aico:help [command]`** — lists every command, or explains one: usage, each option and its effect, what it does, what you get. Every command also takes `help` / `--help` (e.g. `/aico:feature help`) to show the same.
- **`/aico:version`** — shows the installed plugin version (from `plugin.json`) with its latest changelog entry. Read-only.

### Changed
- **Every command takes `help`.** A lone `help` or `--help` argument on any Playbook shows its `/aico:help` entry and runs nothing.
- **`/aico:brainstorm`** accepts a `.company/cooler/` file; its Overheard list becomes the idea.
- **`/aico:lead`** routes "let colleagues chat informally about the project" to `/aico:cooler`.
- **Docs:** `/aico:cooler`, `/aico:help` and `/aico:version` in the README table, the command guide (the Setup section is now "Setup and help"), getting started, concepts (`.company/cooler/`), the Glossary (Cooler) and the spec (v0.8).

## [0.7.3] - 2026-10-21

### Changed
- **Every ask to the CEO is a form.** Gates, `needs-ceo` questions, picks from audit/pentest/vulnscan/feedback/usability reports, escalations, brainstorm rounds and setup approval all go through AskUserQuestion; the Lead's text reply carries summaries and paths only and never ends with a question (`aico:pipeline`).

## [0.7.2] - 2026-10-21

### Changed
- **Code comments are about the code only.** No Handoff, Step, Role, AI or company notes in product code, tests or config; they stay in `.company/` (`aico:tdd`, `aico:handoff`). The Code Reviewer blocks such a comment as `spec` (`aico:review`).

## [0.7.1] - 2026-10-21

### Added
- **Context budget** — no agent may go over 150k tokens of context. A Role near the budget stops at a clean point and writes a Handoff with the new `status: handover`; the Lead dispatches a fresh Step of the same Role to continue from its `## Next` (no Fix round consumed). The Lead hands itself over via `00-lead-state.md` and a fresh session (`aico:handoff`, `aico:pipeline`).

## [0.7.0] - 2026-10-20

Streamlining the company's own workflow (from the "faster, streamlined development" brainstorm). No new Roles — shared machinery instead.

### Added
- **Handoff Contract** — machine-readable Handoff frontmatter (`base-commit`, `risk-tier`, `acceptance-ids`, `files-touched`) and a `contract|spec|security|test` blocking taxonomy, so the Lead routes and resumes from fields, not prose (`aico:handoff`).
- **`/aico:triage`** — a pre-router Playbook: classify a request by size, risk and type and recommend the shortest valid route before the Brief Gate; risk always overrides size.
- **Plugin CI** (`.github/workflows/ci.yml`) running the checker and tests on every PR, and a **version-consistency check** in `scripts/check.mjs` (plugin.json vs CHANGELOG vs documentation).
- **Deterministic pre-filter** before the Code Reviewer: additive only — it appends findings, never closes a review, never consumes a Fix round.

### Changed
- **Parallel by default** in `aico:pipeline`: independent Roles and Modules are dispatched together; sequence only on real dependencies.
- **Diff-scoped review** from the dispatch's `base-commit`, never `HEAD~1` (`aico:review`, code-reviewer).
- **Risk-tiered testing** (QA): the Brief sets the tier (forced high for auth, payments, personal data, migrations, Contract changes); every acceptance criterion keeps its test; QA may raise a tier, never lower; the full suite still runs at the Ship Gate.
- **Warm rule packs** (`aico:ruleset`): a library pack is reused only if ≤90 days old with no new advisory since; kept-current stacks are JavaScript/Node, SQL (PostgreSQL/MySQL/MariaDB), React, Go, Rust, PHP, CSS, HTML.

## [0.6.0] - 2026-10-20
- On-demand **pentester** (`/aico:pentest`) and **vuln-scanner** (`/aico:vulnscan`) Quality & Security Roles. 29 Roles.

## [0.5.0] - 2026-10-19
- **`/aico:brainstorm`**: Roles weigh in on an idea over rounds until the CEO says done, then build / roadmap / nice-to-have / park.

## [0.4.0] - 2026-10-19
- **Senior Engineer** and the **Ruleset** (sourced Must/Should/May rules per tool, security as law) via **`/aico:standards`**.
