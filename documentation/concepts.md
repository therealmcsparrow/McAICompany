# Concepts

The ideas the whole company runs on. Short definitions of every term are in [`../GLOSSARY.md`](../GLOSSARY.md).

## Roles, the Lead and the CEO
You are the **CEO** — the human. You're not a Role; you have the final say and approve work at Gates. The **Lead** (Project Manager) takes your request, picks the Roles, sequences them and runs the Gates. A **Role** is a specialist agent that starts with a fresh context, does one job, and hands off. See [Roles](roles.md).

## Handoffs
A Role never keeps work in its head for the next Role. Each one writes a **Handoff** file — frontmatter plus `## Did`, `## Next`, `## Blocking` sections — that the following Role reads. Handoffs live under `.company/work/<task>/` as `NN-<role>.md`. This is why a run survives a Role failing or restarting: the files are the memory, not the conversation.

## The Handoff Contract
Handoffs aren't just prose — each carries machine-readable frontmatter the Lead and later Roles read as fields: `status`, `round`, `base-commit` (what reviewers diff against), `risk-tier`, `acceptance-ids` (which of the brief's criteria this Step delivers) and `files-touched`. Blockers are tagged `contract`, `spec`, `security` or `test` so the Lead routes a Fix round precisely. Because the fields are structured, independent Steps run **in parallel by default**, reviewers scope to `base-commit` instead of re-reading history, and a run can resume from any Step after a restart.

**v1.1 (pilot, off by default).** With the setting `pipeline.review_format: pilot` (default `plain`, see [Settings](#settings)), the code-reviewer and the compliance Step of the senior-engineer also write a short `aico-top` block right under the By line, with `status`, `files`, `ac_ids`, `rule_ids`, `risks`, `read_next` and `tokens_used`. Their findings are rows: `ID | file:line | problem | why | fix`. The IDs are stable, so a Fix round cites `R-3` instead of retyping the finding, and "why" is never empty. A malformed block blocks that Step. With `plain`, they write ordinary findings and no block. Other Roles write Handoffs as before; the body stays plain English for Gate summaries, exceptions, Debt and security risks. The block is widened to more Roles only after the token numbers support it.

## Context budget
No agent works with more than **150k tokens** of context by default, the Lead included. Long contexts get sloppy and compaction drops detail, so a Role that gets close stops at a clean point (tests green, nothing half-edited) and writes its Handoff with `status: handover`, listing exactly what's left under `## Next`. The Lead then dispatches a fresh Step of the same Role to carry on from there. A handover isn't a failure and doesn't use up a Fix round. If the Lead itself gets close, it saves the run state to `00-lead-state.md` and asks you to continue in a fresh session with "resume <slug>".

You can change the limit for Roles in [settings](#settings) as **max context** (`context_cap`): one global value, with an override per Role. The default is 150000 and the floor is 60000; lower values are refused. A Role hands over at 80% of its cap. High-risk work never gets less than the default, whatever you set. The cap is a soft limit that the Lead passes in each dispatch; it is not enforced by the model.

## Token cost
aico records how many tokens each Step used in a ledger at `.company/ledger/<run>.jsonl`. The ledger stores **counts only**: no prompts, no replies. At the Ship Gate the Lead shows one cost line, with spend (input, cache write and output) and cache read kept apart. `/aico:feedback` compares the last three runs.

### Run scorecard
Once you approve the Ship Gate, the Lead prints one scorecard line for the run. Each figure sits beside the median of the last 5 shipped runs:

- **time**: from the start of the run to the Ship Gate answer, including your waits.
- **CEO wait**: how much of that time was spent waiting for your answer at the Brief, Plan and Ship Gates.
- **spend/AC**: spend tokens (input, cache write, output; cache read is left out) per shipped acceptance criterion. It reads `not reconciled` when the run has no reconciled counts.
- **fix rounds** and **high blockers**: the totals for the run.
- **gate rejects**: the number of "no" answers at the three Gates.

Reading the line:
- `n=<k>` means the median uses only k earlier runs (1 to 4). `no baseline` means there are none yet.
- `excluded: <n>` counts runs left out of the median: brainstorm, replay and baseline runs, and runs without times.
- With a token baseline, a `30% target` segment compares spend per AC with that baseline and reads `met`, `missed` or `not reconciled`. `met` also needs fix rounds and high blockers no higher than the baseline's.
- Older ledger files still work. They count as untimed and appear under `excluded`.

The scorecard only reports. It never blocks a Step or a Gate. It stores times, counts and tier, never prompts, replies or names, and the ledger stays in the repository. It is committed with the run only when the product tracks `.company/`, otherwise it stays local. It leaves your machine only when a branch that holds it is pushed. The numbers are a baseline to measure changes against; aico makes no speed or cost claim from them yet.

The savings come from reading less: shorter prompts, fewer file reads, fewer dispatches, a digest in place of a full transcript. Brainstorm Roles also keep one constant prompt for the whole run, with changing content in a per-round input file. aico claims no saving percentage for this yet. Prompts keep one fixed order so they stay readable and testable.

## Tool checks, slices and review depth
- **Tool checks.** A rule can carry `check: <tool>` or `check: judgment`. Checks bind to a rule by its ID in `.company/checks.json` and run before review. A failure becomes a finding that the reviewer must confirm before it blocks. Compliance stays a separate lane.
- **Rule slices.** These stay on whatever the review format is. Each task gets only its mapped rules, and always every security Must. The Senior Engineer renders them into one small file per task, `.company/work/<slug>/rules/<task>.md`, with the rule text included. Builders get that file instead of the full ruleset map. `rule-check slices` verifies the files and flags missing, stale or extra ones.
- **Findings ledger** (only with `pipeline.review_format: pilot`). A reviewer writes its findings and checked files to `<NN>-code-reviewer.findings.md` only when a handover is near (at 75% of the max context, or once it decides to hand over). A handover without a ledger fails the lint, so nothing is lost; a review that finishes normally needs none.
- **Review depth** follows the paths touched (`scripts/review-depth.mjs`), not the builder's own label. Contract, Core and security paths always get a full review.
- **Golden Handoffs and the regression set.** Reference Handoffs and past high-tier defects run under `npm test`, so a change that loosens a Gate or the Handoff shape fails a test.

## Risk tier
Every piece of work gets a tier — `low`, `medium` or `high` — set in the brief and confirmed by you at the Brief Gate, then carried in every dispatch. It's forced **high** for anything touching auth, payments, personal data, migrations or a Contract. The tier drives how deep QA tests, how much of the ruleset applies, and how short a route triage may recommend. A Role can raise a tier but never lower it, and no tier ever removes a criterion's single test or skips the Ship Gate's full suite.

## The reviewer pre-filter
Before the Code Reviewer runs, a cheap deterministic check (the same `aico-check` the CI uses) scans the diff and hands its findings to the reviewer. It is **additive only**: it can append tagged findings but never remove, downgrade or close one, never marks a review done, and a pre-filter block never counts against the Fix-round limit. Only the Opus reviewer closes a review. This spends human-grade attention on logic and Contracts, not mechanics — without softening any Gate.

## Gates
A **Gate** is a point where the Lead stops and waits for your approval. There are three: **Brief** (scope agreed), **Plan** (plan/design agreed) and **Ship** (before anything is released or made public). At each you can Approve, Change or Stop. Every question the company puts to you — Gates, picks from a report, decisions a Role can't make — comes as a form you click through, never as a question buried in the chat output. See [Getting started](getting-started.md#the-three-gates).

In [settings](#settings) you can set a Gate to **auto**: the Lead writes the Gate summary to the run folder and carries on, then tells you it did. The Ship Gate and installs start **locked** (see [Locks](#locks)). An auto Ship Gate commits the run's wrap-up, pushes the branch and opens a PR, then stops. It never merges. Some asks always stay a form whatever the settings say: Must exceptions, Blocking security findings, picks from a report, escalations, design-skill approval, and anything sent outside your machine other than that PR (client messages, publishing, authority reports, production deploys, and every Ship Gate in `/aico:incident`).

## Plan check
At the Plan Gate the Lead runs a text-only check on the plan file. It lists choices the plan left open. It reads no model and changes nothing in the plan.

**What it looks at.** Only lines under a `##` or `###` heading that starts with Steps, Tasks, Wave, Phase, Fix round, or `T` or `M` and a number such as `T1` (any case). Lines in code fences, inline code, blockquotes and `Decided:` lines are skipped. A line is a finding when it holds `TBD` or `TODO` (whole word, capital letters), `decide later` (any case), or ends in `?` and contains ` or `. One finding per line. A code fence that is never closed is also a finding, because it hides the rest of the plan.

**What you see.** A **Plan check** block under the Gate summary: `plan-check (<policy>): <n> open decision[s], <d> decided`, then up to 5 rows `file:line | phrase | why`, then `+<k> more` if there are more. With zero findings the block still shows, so silence never means the check was skipped. The block is plain text for a screen reader. Under `warn` (the default) the check never blocks. Under `block`, the scripts refuse the Plan Gate record, the build start and every task start while decisions are open (see [The hook Gate](#the-hook-gate)). With policy `off` no scan runs and the run is marked check-off.

**`Decided:` lines.** When the Architect settles a choice that was open or debated, the plan gets its own line: `Decided: <choice> because <reason>`. Only that full shape is skipped by the check; `Decided: A or B?` is still a finding. Builders cite the `Decided:` lines under `## Decisions` in their Handoff.

**Waving off a warning.** If there are findings, the Plan Gate form adds the question "Plan check: mark warnings as noise" with the options "None (Recommended)", "All <n>" and a count through Other. The Lead records the number. After you answer Change, the revised plan is checked again at the next Plan Gate.

**What is stored.** One file per run, `.company/work/<slug>/plan-check.jsonl`, with counts, enums, the plan file name and times only. No plan text, no phrase and no CEO text. It stays with the run's Handoffs: committed only where the product tracks `.company/work/`, otherwise local. Before the Ship Gate the Lead reads it and shows a line `plan-check marker: <state>` if the check did not run; this never blocks. The ledger and Handoff frontmatter are not changed.

**The verdict.** `/aico:feedback` compares the median [Fix rounds](#fix-rounds) of the newest check-on runs with the same number of earlier runs (check off, or from before the check). The number of runs is Verdict runs in [settings](#settings), default 5. It says `pass` only when the check-on median is at least 1 lower, `fail` otherwise, and `insufficient (n=<k>)` when either side has too few runs. On `fail` the line adds `default should become off`; nothing changes by itself. It also shows the share of warnings you waved off and adds `retune` above 30%. Until it says `pass`, treat the check as a trial: it is not shown to reduce Fix rounds.

**How a run's Fix rounds are counted.** A Fix round is a builder sent back for a Blocking review or QA finding after the Plan Gate and before your first answer at the Ship Gate. Work after a changed Ship Gate does not count. The number is the `fix_rounds` value in the run's ledger `ship` line, and a run is used only when the highest `round:` in its Step Handoffs up to that Gate gives the same number. Runs where the two differ, or that have no ledger value, are left out and the verdict line shows a warning count.

**History scan.** `plan-check-verdict.mjs history` runs the check over past plans in the working tree and in git history, read-only, and prints findings to the terminal. It writes nothing to the repository or `.company/`. A person supplies true and false labels in a file to get a false-positive rate.

## Parallel Steps
The Lead starts plan tasks with the script `plan-tasks.mjs` (Contract `plan-tasks` v1.1), not by its own judgment. The script reads the task fields in the plan and says which tasks may start now.

**Goldfish builders and reviewers.** Each builder gets a task brief, not the whole plan: `plan-tasks.mjs brief` writes the task's own block, the plan's Contracts, the plan-wide `Decided:` lines and the sections that name the task to `.company/work/<slug>/tasks/<id>.md`. The code reviewer and QA first judge the diff against the brief's acceptance criteria, the plan and its Contracts, and only then read what the builders wrote about their work, so a builder's own account cannot steer the first pass.

**Task syntax.** The Architect writes each task as a heading under `## Tasks` with four list lines:

```markdown
### T3 ledger par record and parallel verdict
- role: ai-data-engineer
- files: scripts/ledger.mjs, scripts/ledger-par.test.mjs, docs/contracts/token-ledger.md
- depends-on: T1
- parallel: yes
```

`files:` lists every file the task creates or edits, as repo-relative paths. A directory counts only when the task owns everything under it. Globs, absolute paths and `..` are not valid, and a path part that ends in `.` is refused (Windows). `depends-on:` is `none` or task IDs. A dependency on a later task is allowed: tasks run in dependency order, and only a real cycle (a dependency on the task itself included) makes a task run alone. `parallel:` is `yes` or `no`.

**Alone.** A task runs alone, and the Plan Gate shows one warning line with the reason, when it has no `parallel: yes`, has `parallel: no`, or has a missing or invalid field (for example an unknown Role, an invalid `files:` list, an unknown dependency, a cycle or a repeated field). Only a task with `parallel: yes` and valid fields can run beside others.

**Overlap.** Two tasks that share a path (compared without regard to case or `\` versus `/`, a directory covering the paths under it) never run at the same time. They run in the order the script visits the tasks: plan order, except that a task moves back after the tasks it depends on.

**The cap.** At most `pipeline.parallel_cap` Steps of a run run at once. The value is a whole number from 3 to 5; the default is 4, and an invalid stored value falls back to the level below (your user value, else 4) with a warning. Set it in `/aico:settings`. A project value counts and it is not a lock. The cap also limits other parallel Steps in a pipeline run (for example the review lanes). Read-only fan-outs (brainstorm, research, cooler, usability-test Personas) are not capped.

**Sequential.** Setting Dispatch (`pipeline.dispatch`) to `sequential` overrides the cap with 1. It is the emergency switch: one Step at a time.

**At the Plan Gate.** The Lead shows a **Parallel plan** block under the summary: a first line with the task, marked and alone counts and the cap, one `wave` line per wave (a task that waits shows why: `depends`, `overlap`, `alone`, `barrier` or `cap`), and one `warning` line per alone task. The block never blocks the Gate.

**Out-of-list paths.** Each plan-task Step gets `Task:` and `Files:` lines. Before the commit, the Lead sorts the Step's changed paths. A path outside `Files:` is committed and named to you as extra. A path that belongs to another running task is not committed; the Code Reviewer records it as a `[spec]` blocker. The count of extra plus sibling paths goes to the run's `par` ledger line.

**What is stored.** The run record `.company/work/<slug>/parallel.jsonl` holds task IDs, repo-relative paths, the plan file name, a plan hash, the cap, the mode and UTC times. It holds no Handoff, plan or CEO text. It stays with the run's Handoffs: local where `.company/work/` is ignored. At `ship` the ledger gets one `par` line of four whole numbers (cap, peak Steps at once, tasks that waited for an overlap, out-of-list paths). The ledger stays local to the repository and keeps counts only.

**The verdict.** `/aico:feedback` quotes one `parallel verdict:` line from `ledger.mjs parallel-verdict`. It compares the newest runs on v0.18 with a cap of 2 or more against v0.17 runs, both with at least 2 builder Steps and on the same plan check key and model floor. With fewer than 10 runs on either side (default; `--runs` sets 3 to 50) it says `insufficient (n=<k>)`. It says `pass` only when time minus your wait at Gates is at most 0.75 times the v0.17 value, Fix-round, high-blocker and Gate-reject medians are not higher, spend per AC is at most 1.10 times the v0.17 value, and the out-of-list median is 0. Otherwise it says `fail`. Until it says `pass`, nothing here is shown to save time. The verdict never blocks a Step or a Gate.

**Rolling back.** When the verdict says `fail`, set `pipeline.parallel_cap` to 5 in `/aico:settings`; the verdict line names this step. If the runs already used a cap of 5, set `pipeline.dispatch` to `sequential` instead. Reviewer, QA and Security verdicts and the Gates do not change.

## Short path for low-risk work
For `/aico:feature` and `/aico:fix`, the script `tier-set.mjs` (Contract `tier-sets` v1) decides which Roles and lanes a run dispatches. It reads the plugin's data file `company/tier-sets.json`. Nothing you or a report writes can add, drop or rename an entry. Every other Playbook keeps its route.

**What a low run skips.** An entry runs only when the script lists it for the tier and the Playbook's usual condition holds (UI work, lane settings, user-facing change, a release needed). The script's list can only remove entries from today's route, never add one.
- Feature at low: no persona tester, no `senior-engineer-research`, no security lane, no compliance lane and no hands-on tester. When ruleset research is due, the Senior Engineer maps the rules instead and writes one `## Debt` line per missing, stale or new pack.
- Fix at low: no security lane.
- Feature at medium and high, and fix at medium and high, keep the full route.
- The legal advice Role and the accessibility tester stay at every feature tier, so EU law advice and accessibility testing do not depend on the tier.

**What never changes.** Every Gate, the single test per acceptance criterion, the fix regression test, the full suite before the Ship Gate, the reviewer pre-filter and the Handoff lint. A company type's `ship.lanes` also still run.

**What raises the tier.** The run tier is the highest of the triage tier, the tier any Step reports, and the result of the path check. It only goes up. The path check forces **high** for:
- a file under `docs/contracts/`;
- a path listed under `## Core` in `.company/project.md`, and always `.company/project.md`, `.company/settings.json` and `.company/standards.md` themselves, even when `## Core` lists nothing;
- a path with a part named like auth, login, session, password, secret, payment, billing, consent, privacy, migration and the other words in the data file's list. Whole words only: `scripts/lessons.mjs` does not match.
- a check that cannot be answered (plan has no `files:` lines, git fails, the base check fails, `## Core` unreadable at the base commit).

Every git call of the script ignores replace refs, so the commit id the run names is the real commit. The base is the full-length commit id of the repository's own object format, and it must be an ancestor of HEAD. At each check the Lead passes its own base, and it must be exactly the base recorded at `begin`; a different or unresolvable base makes the check unanswerable, so the run goes to high and never gets shorter.

The check reads file names, not file content. A risky change inside a plainly named file is not seen by it, so a Role or the Code Reviewer has to raise the tier. When a check raises a short run, the Gate summary shows `add before ship:` and the Roles it names run before the Ship Gate. You can also ask for the skipped Roles at a Gate; the Lead then raises the run to medium.

**At the Brief Gate (feature).** When the run is low, the Lead shows what would be skipped (`skipped by tier:`), and the form offers **Approve, short path (Recommended)**, **Approve, full path**, Change and Stop. The short path starts only after the first: it needs your explicit "Approve, short path". An auto Brief Gate always takes the full path, and a missing or any other answer means full. Every Brief, Plan and Ship Gate summary of a feature or fix run shows the path lines (`path:`, `skipped by tier:`, `add before ship:`).

**How a fix gets low.** A fix has no Brief Gate. It starts low only when the bug request ends in the triage line `route fix` with `risk low` and `/aico:triage` recorded that exact request (see [`/aico:triage`](commands.md#aicotriage)). Otherwise it starts at medium. A low fix takes the short path only from that trusted triage record while `gates.brief` is `ask`, because then you saw the triage form that named the skip; with an auto Brief Gate, or no readable setting, it takes the full path.

**The Short path switch.** `pipeline.short_path` in [settings](#settings) is `on` or `off`, default `on`. `off` wins: a project can only turn it off, and a project `on` never overrides a user `off`. With the switch off, or when the settings cannot be read, every run takes the full route.

**Fail closed.** If the data file is refused (missing, too large, not valid, or not matching the v0.18 route for medium and high), both Playbooks use the high set and the Gate summary names the `tier-sets: refused` line. What a short run skipped is fixed at `begin` and read only from its record. If the data file is refused later, or its `rev` differs from the recorded one, the run goes to high (cause `sets`) and every skipped entry comes back before the Ship Gate. A script error or a broken record also makes the Lead run the rest of the run as high. A change never makes a run shorter.

**What is stored.** `.company/work/<slug>/tier-path.jsonl` holds enums, whole numbers, a commit sha and UTC times: the Playbook, tier, path, why, the data file's `rev` and any raise with its cause. The ledger's `meta` and `ship` lines get the Playbook, `rev`, path and raised flag as enums and integers (Contract `token-ledger` v1.4). Paths found by the check are shown to you and not stored. Both files stay local where `.company/` is ignored.

**The verdict.** `/aico:feedback` quotes two `low-path verdict:` lines from `ledger.mjs low-path-verdict`, feature then fix. The newest short runs are compared with earlier low runs (before v0.19, or v0.19 runs that took the full path) on the same plan check, floor and cap keys. With fewer than 10 runs on either side (default; `--runs` sets 3 to 50) it says `insufficient (n=<k>)`. It says `pass` only when time minus your wait at Gates is at most 0.75 times the earlier value, the medians of Fix rounds, high blockers and Gate rejects are not higher, spend is not higher, and at most 20% of the short runs were raised. Otherwise it says `fail`. Until it says `pass`, nothing here is shown to save time. It never blocks a Step or a Gate. Short runs are also left out of the parallel and plan-check verdicts.

**Rolling back.** In this order:
1. Set `pipeline.short_path` to `off` in `/aico:settings`. Every later run takes the full route; the setting switches both Playbooks.
2. If only the fix side failed, the fix low set is changed in the data file in a release (a new `rev`), because the setting cannot switch one Playbook.
3. A tune of the sets is also a data-file change in a release with a new `rev`.

## The hook Gate
`plan_check.policy` is `warn`, `block` or `off`. Under `block` the scripts refuse the Plan Gate record, the build start and every task start while the plan has open decisions. The scan reads the plan itself, reads no record and writes nothing. A plan entry that is a link or not a plain file is an `unreadable` error, never skipped. A project can raise the policy to `block` but cannot lower a `block` set in your user settings. Under `warn` and `off`, behaviour is unchanged.

## Judging changes
These checks apply to every run from v0.20.0.
- **Base commit.** The `Base commit:` of a prompt is the full object id (40 or 64 hex digits), never a short sha or a ref. Reviewers judge the diff from that base to the run branch.
- **Grafts.** A git grafts file makes every judging check stop: tier checks answer `diff unknown`, review depth goes to `full`, and `rule-check` refuses to run.
- **Binary files.** Binary is decided by file content. The binary type list is fixed. A file outside the list that holds binary content in a text path (`binary content in a text path`) blocks until it is fixed or you grant an exception. A text file marked binary by git attributes is shown to reviewers through `rule-check text`, never through a path they type.
- **Contested findings.** A builder can contest a reviewer finding instead of fixing it. Every reviewer finding has an ID of the form `<NN>-<role>:R-<n>`. A security finding never closes by contest.
- **Receipts.** `token-ledger` has a `receipt` command for a run's cost record.

## Cost from telemetry
The scorecard shows a cost segment only when a cost is recorded, and never estimates one. The number is Claude Code's approximate cost from telemetry, not a bill. aico reads an OpenTelemetry export file you set up, matched by session id inside the run window.

**Setup.**
1. Run an OpenTelemetry Collector with a minimal YAML: an OTLP receiver on `127.0.0.1` only, and a `file` exporter to `<MCSPARROW_HOME or ~/.mcsparrow>/otel/metrics.jsonl`. No rotation, no headers, no tokens.
2. Set the Claude Code telemetry variables in your own shell or in `~/.claude/settings.json`, never in a repository file.
3. Export metrics only. Do not set the `OTEL_LOG_*` content flags.
4. Keep delta temporality, which is the default.

The Collector `file` exporter is alpha. The file holds account attributes that aico never reads.

## Releases
A release carries a `Rollback:` line, an SBOM and a Gate Report. This makes no claim to BSI TR-03183-2.

## Residual risks
These are limits of the checks, stated plainly.
- **The plan scan.** A Role that edits `Decided:` lines into the plan, or appends a `begin` record and rewrites the plan into a clean one, passes the scan. Read the plan at the Plan Gate.
- **User settings.** A Role with Bash can write your user `settings.json`. "Block wins" guards against project files only, the same limit as `pipeline.short_path`.
- **Git environment.** The judging scripts drop inherited `GIT_*` variables. A Role that can write `.claude/settings*.json` or a shell profile can still add hooks or aliases that change later commands.
- **Crafted binary files.** A file on the binary type list whose leading bytes are both a media header and code passes as `binary file changed`. These signatures are also a valid JavaScript start: `true` (ttf), `GIF8` (gif), `ID3` (mp3), `OggS` (ogg), `fLaC` (flac), `OTTO` (otf), `wOFF` (woff), `wOF2` (woff2), `RIFF` (webp, wav), and any 4 bytes plus `ftyp` (mp4, m4a, mov). CommonJS `require` runs such a file whatever its extension, so reviewers block any change that loads such a file as code, by any route.

## Core + Modules + Contracts
Every product is built the same way:

- **Core** — the small, stable center. Only CEO-approved items go in Core.
- **Modules** — self-contained feature units built against Contracts, in parallel when their Contracts are settled.
- **Contracts** — the versioned interfaces and schemas Modules talk through. The Architect owns them; builders code against them.

This keeps Modules independent and swappable, and keeps the risky surface (Core) small and approved by you.

## The Ruleset
A product's binding engineering rules, kept by the **Senior Engineer** and signed off by the Architect. Built and maintained with [`/aico:standards`](commands.md#aicostandards).

- **Rule packs** hold the rules for one tool and major version (`<tool>@<major>.md`), each rule with its source URL. They live in a shared library on your machine (`~/.mcsparrow/standards/`) and are copied into each product under `.company/standards/`; the product's own rules and the pack list live in `.company/standards.md`.
- **Freshness.** `node scripts/check.mjs --packs <dir>` fails a library pack that is older than 90 days or has a new advisory in its `advisories.json` since its date. CI checks the committed copies and fails only after 180 days, so CI doesn't go red just because a copy aged. The checker never goes online.
- **Tiers:** **Must** (always followed; a break blocks a run — all security rules are Must), **Should** (followed, or a written reason) and **May** (advice).
- **Sources:** Must rules come only from primary sources — official docs, style guides, linter defaults, and security bodies (OWASP, CWE, CISA KEV, vendor advisories). Should/May may also cite well-known community guides. Blogs, forums and AI-generated content are never a source.
- **Exception:** only you (the CEO) can approve not following a Must, in a stated scope. It's recorded with its date.
- **Security is law:** builders follow the rules *before* review, so a Fix round caused by a rule break is treated as a process failure, not normal flow.

## Debt
Existing violations of a rule that arrived *after* the code was written. Debt is listed in the Ruleset and **never blocks** a run — you decide when to pay it down with a fix or refactor run. The one exception: an existing violation of a security Must that is actually exploitable is Blocking.

## Fix rounds
When a reviewer, QA, Security or the Senior Engineer (compliance) finds a blocking problem, the builder is sent back — at most **twice** by default. After the last round it escalates to you. You can set the limit from 0 to 5 in [settings](#settings); at 0 the first blocking review comes straight to you. Nits never loop. The run's count stops at your first answer at the Ship Gate. A finding caused by a choice the plan left open is also listed as a Nit tagged `[open-decision]`; a real bug it caused stays Blocking. See [Plan check](#plan-check).

## Lessons
When a run ships, the Lead appends up to three one-line **Lessons** to `.company/lessons.md`. Later runs read it and pass the relevant lines to each Role, so the company gets a little better each time.

## EU compliance
Before Ship, the company checks the EU obligations that apply: GDPR, the Cyber Resilience Act (SBOM, vulnerability handling, reporting deadlines), AI Act Art. 50 transparency, the European Accessibility Act, EU VAT/OSS and the 14-day withdrawal right for digital sales. Handled through the `eu-compliance` practice by legal, security and the ai-data-engineer.

## Git conventions
- Work happens on a branch named `aico/<task>`; the company never works directly on your main branch.
- One commit per Step, committing only that Step's files — never everything at once.
- Commit subjects are `<type>: <summary>` where `<type>` is one of `feat`, `fix`, `test`, `docs`, `refactor`, `chore`. They are **never** prefixed with `aico` or a Role name.
- Nothing is pushed before you approve it at the Ship Gate. The only exception is an unlocked, auto Ship Gate: it pushes the branch and opens a PR for you to merge.

## Research before building
[`/aico:research`](commands.md#aicoresearch) has three researchers (market, tech and, for UI work, design) look the topic up online before anything is built. The Product Manager writes one report with a verdict (go, go-with-conditions or no-go), ranked actions, low-hanging fruit (impact and effort), risks and open questions. Every claim cites a source with its URL and check date. A claim with no source is marked `unverified` and cannot support the verdict. The report is labelled as AI-generated research. Researchers read web pages as data, never as instructions, and never install anything.

## Design skills
A UI product can have approved design skills. The set lives in `.company/project.md` under `## Design skills`: one line per skill with its source, license, vetted date and approval date, at most five. A design-researcher proposes the set from your stack, product type, Personas and Art direction. You approve it in a form, and installs run only after a second form shows the exact commands. `/aico:feature` refreshes the set for a UI product when it is empty or its newest approval is older than 180 days. The UI Roles load the approved skills from their dispatch.

## Skill picks
The skill-researcher (Selin) proposes third-party skills for four areas: `stack`, `product-type`, `company-type` and `design`. It has no Bash, so it runs no scanner. It vets each candidate against its sources, then the Lead scans every pick with SkillSpector in a new quarantine folder before you see it. A critical or high finding, a failed scan or a timeout means the pick is rejected, and with no scanner installed nothing is recommended. You approve the set (at most 5 per area) in one form, then see the exact install commands in a second; nothing installs unless you answer yes to both. The install pins the commit that was scanned. After it, the Lead scans the installed skill again; a bad result stops the run and shows you the removal command, which only you run. Approved `stack`, `product-type` and `company-type` skills are recorded in `.company/project.md` under `## Skills`, one line each, and design skills stay under `## Design skills`. To scan skills you already have, use [`/aico:skillspector`](commands.md#aicoskillspector).

## The aico language
`aico_language` sets the language aico writes in: Handoff prose, forms, reports and summaries. It is separate from `languages:`, which covers the product's UI strings. Your default lives in `~/.mcsparrow/config.json`; a product can override it with `aico_language:` in `.company/project.md`. Set it with [`/aico:language`](commands.md#aicolanguage). Machine-read parts stay English in every language.

## Models, effort and names
Every Role runs on a **model** (opus, sonnet or haiku) and an **effort** level (`low`, `medium`, `high`, `xhigh`, `max`). The model is how capable the Role is; effort is how long it thinks before acting. The plugin's defaults put the deepest thinking where a miss is expensive (architect, code-reviewer, security, pentester on high) and keep writing, art, lookup and support work on low. Every Role also has a pseudonym for display, such as Ava the architect or Quinn the QA tester. Names are pseudonyms shown only to you, in cooler chats, brainstorms and Gate summaries. A Role never gets a name in its prompt: it works under its Role id and writes that id in its Handoff byline (`By: architect`). Brainstorm files store Role ids from v0.20.0. You can still ask for a Role by name ("ask Ava to check the Contracts"); the Lead routes on your words and replaces the name with the Role id before it dispatches. Internal IDs like `aico:architect` never change. The full list is in [Roles](roles.md).

## Which model a Role runs on
Claude Code decides the model of a sub-agent such as an aico Role. The facts below come from the Claude Code documentation, checked on 2026-10-28: https://code.claude.com/docs/en/sub-agents. Quotations are short and are the documentation's words, not instructions to a Role.

### The order today
From Claude Code 2.1.251, the documentation lists the order as: "1. The per-invocation `model` parameter 2. The subagent definition's `model` frontmatter ... 3. The `CLAUDE_CODE_SUBAGENT_MODEL` environment variable ... 4. The main conversation's model" (https://code.claude.com/docs/en/sub-agents).

- **Agent `model`.** The Lead can pass a model when it starts a Role. The documentation says the call takes "sonnet, opus, haiku, or fable. Claude can't pass a full model ID or `inherit` on that call" (https://code.claude.com/docs/en/sub-agents).
- **Mod `agent.spawn` hook.** An installed mod can set the model too. The documentation says a mod's `agent.spawn` hook model replaces the per-invocation parameter (https://code.claude.com/docs/en/sub-agents).
- **Frontmatter `model`.** Every aico Role sets `model:` in `agents/<role>.md`.
- **`CLAUDE_CODE_SUBAGENT_MODEL`.** On its own this is a default. The documentation says it "is a default" (https://code.claude.com/docs/en/sub-agents). Because every aico Role has a frontmatter model, it changes no Role on 2.1.251 or later. Setting it to `inherit` is the same as leaving it unset.
- **Main conversation's model.** Used only when nothing above is set.

### Before 2.1.251
The documentation says: "Before v2.1.251, `CLAUDE_CODE_SUBAGENT_MODEL` came first in this order and overrode both the per-invocation parameter and the frontmatter, including `model: inherit`" (https://code.claude.com/docs/en/sub-agents). On those versions the variable overrides every Role.

### Forcing one model
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` set to `1` applies the variable's model to every sub-agent. The documentation says it "Requires Claude Code v2.1.257 or later" (https://code.claude.com/docs/en/sub-agents). Set on its own, it runs sub-agents on the main conversation's model (the built-in Explore agent excepted), per the same page.

**Unverified:** whether `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` also beats the Agent `model` parameter. The documentation says "every subagent" but does not state it. aico treats it as a bypass of the floor below.

### Where aico's settings enter
`roles.<role>.model` from [settings](#settings) is not a Claude Code setting. The Lead reads it and passes the result as the Agent `model`. Without a stored model, the Role runs on its frontmatter model.

### The floor and the protected Roles
`company/model-floor.json` lists a **floor** for every Role: the model that Role had in v0.16.0. The floor is the lowest model it runs on in these cases:
- **High risk tier.** The Lead raises a Role below its floor to the floor, passes it as the Agent `model` and writes `floor` at the end of the `Settings:` line of the dispatch. At low and medium tier a Role that is not protected runs the model you set.
- **Protected Roles.** `architect`, `code-reviewer`, `pentester`, `security` and `vuln-scanner` hold their floor at every risk tier. A lower `roles.<role>.model` is not applied and the settings warning says so. No unlock lifts this. If the floor file cannot be read, every Role is held at `opus`.
- **Order of the ranks:** `haiku`, then `sonnet`, then `opus`. `fable` is not ranked, so a Role set to it runs at its floor where the floor applies. The Agent call cannot take `inherit`, so the Lead first turns `inherit` into the model of its own session, then applies the floor to that model.

### The model environment line
At the start of a run the Lead runs `settings.mjs model-env`. When `CLAUDE_CODE_SUBAGENT_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set, it prints one line with the Claude Code version, what the variable does on that version, and whether the floor is `kept` or `bypassed`. It prints nothing when neither is set. A line ending `floor bypassed` is also shown at the Brief Gate of a high-tier run. With `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` set, aico reports `floor bypassed` unless both version sources agree on a version below 2.1.257. If the version cannot be read, the line says `version unknown` and counts as bypassed.

### The agent description warning
Claude Code warns at startup when agent descriptions are long. The documentation says: "When the combined descriptions of your subagents, except the built-in ones, exceed 15,000 tokens, Claude Code shows a warning at startup" (https://code.claude.com/docs/en/sub-agents). The error reference adds: "Claude Code loads every agent whether or not the total is over the limit" and that each agent counts "its name plus its `description` frontmatter" (https://code.claude.com/docs/en/errors.md#agent-descriptions-are-over-the-15000-token-limit).

**Unverified:** whether agents that come from a plugin count toward the 15,000 total. The documentation says "your subagents" and does not name plugins. The documentation does not name the token estimator either, so `npm run check` counts UTF-8 bytes, which never counts under, and fails at 15,000 or more. It also fails a Role description over 400 estimated tokens.

## Company types
A project has one company type. It decides which Roles and Playbooks the company has and what "ship" means. Set it with [`/aico:setup`](commands.md#aicosetup); it is saved as `company_type:` in `.company/project.md`. With no `company_type:` line a project is a `software` company, exactly as before. Switching a type later is not supported, and the settings page neither shows nor changes it.

| Type | Roles | Playbooks | What "ship" means |
|---|---|---|---|
| `software` (Software company) | 34 Roles, every Role except the editor | audit, brainstorm, client, cooler, feature, feedback, fix, incident, launch, maintain, pentest, refactor, research, standards, usability-test, vulnscan | Push, merge, release or deploy. Unchanged. |
| `research` (Research consultancy) | 11 | research, client, report, feedback, brainstorm, cooler | The final report goes to the client or is published, with every claim cited `[S#]` or marked `(unverified)`. |
| `marketing` (Marketing and content agency) | 15 | campaign, content, research, client, feedback, brainstorm, cooler | The work is published or handed to the client after the legal and accessibility lanes, with every claim cited or marked unverified. |
| `design` (Design studio) | 19 | design, research, client, feedback, brainstorm, cooler | The design handoff package (files, specs, tokens and the asset licence record) goes to the client or the build team. |

Every type also has `help`, `version`, `language`, `settings`, `setup`, `lead`, `triage`, `skillspector` and `reprompt`, and every type has the reprompter Role. The Lead and `/aico:triage` route only to the type's own Playbooks and Roles, and `/aico:cooler` and `/aico:brainstorm` pick Roles only from it. A Role or command outside the type is refused with the list of allowed ones, and nothing is dispatched.

For types other than `software`, the Ship Gate summary starts with `Ship means: …`. The type also switches on review lanes and checks that settings cannot turn off:

| Type | Lanes forced on at Ship | Checks that must pass |
|---|---|---|
| `research` | legal | `claims-cited` |
| `marketing` | legal, accessibility | `claims-cited`, `ai-disclosure`, `asset-licences` |
| `design` | legal, accessibility, security | `ai-disclosure`, `asset-licences`, `handoff-package` |

A check with no matching Handoff is an open blocker:
- **`claims-cited`**: an editor Handoff in the run with `status: done` and no blocking finding. Every claim is cited `[S#]` or marked `(unverified)`.
- **`ai-disclosure`**: a legal Handoff that states, for each AI-generated public image, video or text, which AI Act art. 50 duty applies and how it is met, or the reason none applies (for example: not a deepfake; a human reviewed it and holds editorial responsibility; not text published to inform the public on matters of public interest). It also says `deepfake: yes` or `deepfake: no`, where a deepfake is a realistic person, place or event. A run with no AI-generated assets states `ai-disclosure: none (no AI-generated assets)`.
- **`asset-licences`**: the same legal Handoff, stating the licence of every asset.
- **`handoff-package`**: a UI/UX designer Handoff that lists the files, specs, tokens and the asset licence record.

A passed check records that Legal stated its position. These checks are a process check, not legal advice or a compliance certificate. Have a qualified lawyer review before you publish. In particular, the timing of the AI Act art. 50 duties may still change, so confirm the dates with a lawyer. Personas used in testing are fictional, and copy must never present one as a real customer.

To see which type a project has, and what it allows, the plugin script `company-type.mjs` prints plain lines by default:

```
company type: research (Research consultancy), from .company/project.md
roles: product-manager, account-manager, …
playbooks: research, client, report, …
work: report
ship: deliver-report. The final report goes to the client or is published, …
ship lanes: legal
ship checks: claims-cited
skill search hints: …
```

A project with no `company_type:` line shows `company type: software (Software company), default: no company_type line`. `work` lists the Playbooks that do the type's main work. When a brainstorm, a research run or a feedback run hands an idea over, it goes to the first of them. Tools that parse the output pass `--json` to get JSON instead. A refusal is one line starting with `refused:` that names the bad input, never a value from your project file.

The `design` company has two Roles that the brief did not list, `code-reviewer` and `security`, because a clickable prototype is code and the security lane is always on. The software Ship Gate is unchanged. If the type setting is broken, for example an unknown value or two `company_type:` lines, a Playbook stops with a refusal and changes nothing.

## Personalities
Every Role has a personality that colours how it comes across in [`/aico:cooler`](commands.md#aicocooler) chats and [`/aico:brainstorm`](commands.md#aicobrainstorm) rounds. It is social-only style data, used there and nowhere else. It never changes a model, an effort, a verdict, a review, a Gate, a Handoff or any other dispatch.

A personality has five fields:
- **Temperament**, **Way of talking** and **Pet topic**: short text, 1 to 80 characters. Letters of any language, digits, single spaces and the marks `, . ' - ! ?` are allowed. Quotes, colons, brackets, line breaks and other symbols are refused.
- **Intelligence** and **Creativity**: `low`, `medium` or `high`. The Role is told a fixed sentence for the level you pick, not the word itself. Creativity shows in how far the ideas reach. Intelligence shapes how the Role reasons, but brainstorm replies are capped at 80 words, so you will see little of it there.

Every Role ships with a default. You can change each field at user level (all projects) or project level. Per field, the project value wins over the user value, which wins over the default. A project value counts without an unlock, so a cloned repo can set a personality. It is passed to the Role only as quoted style data, never as an instruction, and it can only reach cooler chats and brainstorms. A value that breaks the rules is ignored, the level below is used, and the settings page and `settings.mjs get` warnings say which field. The warning does not repeat the value.

Personalities are not part of `settings.mjs get` and are never printed by a command. Personality is about Roles, not real people, so keep real names out of it. Each word of a text field starts with a letter or a digit, and invisible characters are refused. In a first test, a personality changed the tone of brainstorm replies and did not lower the share of replies that pass the parser. A pet topic colours a reply only now and then.

## Settings
[`/aico:settings`](commands.md#aicosettings) opens a page in your browser where you change how the company works. It has seven tabs, in this order. Messages ("Saved.", or a refused Save) show at the top, under the page header, so you see them on every tab.

- **Roles** — name, model and effort for each Role, with a bulk change per department. Every field has a visible label.
- **Personality** — one collapsible card per Role, grouped by department, with a User and a Project group of fields. Each group names its Role and level, for example "Ava (architect), User level". The fields are three text boxes with an "n of 80 characters" counter, and two lists for Intelligence and Creativity. Under each list you see what the Role is told for the level you pick. A blank box means "not set at this level". Above the cards, **Filter Roles** narrows them by name, Role or department, and a line says "Showing n of N Roles". The filter only hides cards: hidden cards are still saved, and the filter text is never saved. A refused Save puts "Nothing was saved. Fix n field(s):" at the top, with one link per problem. A link opens the right tab and card and puts focus on the field. Nothing is saved from a refused Save.
- **Language & profile** — the aico language and the `.company/project.md` profile fields.
- **Pipeline** — the Fix-round limit, the reprompt Question rounds (`reprompt.question_rounds`, 0 to 3, default 1), the Plan check table (`plan_check.policy`: `off`, `warn` or `block`, default `warn`; `plan_check.runs`: 3 to 50, default 5; neither is a lock), parallel or one-at-a-time dispatch, the max context (`context_cap`, global and per Role), the review format (`pipeline.review_format`, below), which optional review lanes run (security, compliance, legal, persona, hands-on and accessibility testing), and the brainstorm options: debate style (`brainstorm.debate`) and the film script (`brainstorm.film_script`).
- **Gates** — ask or auto for the Brief, Plan and Ship Gates and for installs.
- **Mods** — on or off and the options for the four [mods](mods.md), including the Blast Radius commit gate.
- **Skill scan** — the SkillSpector scan mode (`skillspector.mode`: `no-llm` or `claude_cli`, default `no-llm`). `no-llm` sends no skill text anywhere, but package names, versions and ecosystems from a skill's dependency files go to OSV.dev for a vulnerability lookup, plus the ids of any vulnerabilities found. `claude_cli` also sends skill text to Anthropic and counts only from your user settings.

Each setting has three levels, shown side by side: the **plugin** default, your **user** default (`~/.mcsparrow/config.json`) and a **project** override (`.company/settings.json`; profile fields stay in `.company/project.md`). The project wins over the user, and the user wins over the plugin. Changes apply from the next aico run. With nothing set, aico behaves exactly as before.

`inherit` as a model means "use the model of the session you run aico in".

**Review format** (`pipeline.review_format`: `plain` or `pilot`, default `plain`). With `plain`, the Code Reviewer and the compliance pass write ordinary findings. With `pilot`, they also write the `aico-top` block, findings as `ID | file:line | problem | why | fix` rows, and a findings ledger when a review hands over; the Lead then checks those Handoffs with `--require-top`. It is not a lock. What we measured, counts only: in a first test (6 re-reviews each way), 4 of 6 pilot Handoffs failed the lint and 2 of 6 wrote a ledger on a finished review. Those were fixed and tested again (3 re-reviews each way, plus 3 forced handovers and a continuation). Both modes pass: with `pilot`, every Handoff passed the lint on the first try, and with `plain` there is no `aico-top` block and no findings ledger. The one part not exercised is appending to a findings ledger, because no new finding came up. `pilot` cost about 5.7k more tokens per re-review than `plain` (about 27.2k against 21.5k). So `pilot` is an opt-in that costs more and is not shown to save anything. Rule slices for builders and search-then-read stay on with either value.

The page runs only on your own machine (127.0.0.1) behind a one-time link, and closes when you press Done or after 30 minutes idle. At the start of every run the Lead tells you which project-level overrides are active, so a cloned or client repo can't quietly change how its Roles work.

## Locks
Some settings could skip a safety check, so they start **locked**: auto for the Ship Gate, auto for installs, and switching off the security or compliance review lanes. Two mod settings are locked the same way: Blast Radius `security: warn` and switching Blast Radius off (see [Mods](mods.md#locks)). You unlock each one on the settings page behind a warning that says what will no longer ask you. Unlocks count **only from your user settings**: a project file can lock things again but never unlock them, so a repo you clone can't turn on auto-push or skip security review on your machine. If a project's settings file is broken, its locks hold anyway.

## The `.company/` folder
Everything a job produces lands here, in your product's repo, in plain files you can read:

- `.company/project.md` — the product profile (type, stack, voice, license, approved Core)
- `.company/settings.json` — this project's [settings](#settings) overrides, if any
- `.company/work/<task>/` — the Handoffs and reports for each job
- `.company/standards.md` and `.company/standards/` — the Ruleset and its rule-pack copies
- `.company/lessons.md` — the running list of Lessons
- `.company/ledger/` — the token ledger, counts only
- `.company/brainstorms/`, `.company/roadmap/`, `.company/nice-to-have/`, `.company/parked/` — ideas from [`/aico:brainstorm`](commands.md#aicobrainstorm) at each stage
- `.company/cooler/` — recorded chats from [`/aico:cooler`](commands.md#aicocooler)
- `.company/research/` — reports from [`/aico:research`](commands.md#aicoresearch); `outcome:` records your pick
