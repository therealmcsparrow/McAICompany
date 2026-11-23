# Gates

What the Lead runs at a Gate (`ship-check`, `docs/contracts/ship-check.md`; `aico:pipeline` §4, §6).

## Ship Gate: one call
Before every Ship Gate form, once the last review is clean, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" ship-check '<slug>' --base <Base commit> --branch '<branch>' --acs <acs> [--baseline '<run>,<run>,<run>']`.
- `--branch` is the printed `branch:` value; `--acs` the Brief's ACs shipped.
- It runs eight checks, always all, in order: `tree`, `contests`, `drift`, `ledger`, `review-loop`, `tier`, `lead`, `worktrees`. One block per check: `ok`, `block`, or `info`. Last line: `ship-check: <b> blocking, <i> info`.
- Run the full test suite once, in the foreground, after this call; quote its result line. `ship-check` never runs it.
- Exit 0: put the `info` lines (cost, `lead peak`, untracked) in the Ship Gate summary. Exit 1: name each `block` line in the summary and clear it first. Exit 2: you passed a bad argument; fix it, nothing ran.
- A `block` is never ignored; a cost or `lead peak` line never blocks.

## Clearing a `tier` block
The `tier` check blocks on `add before ship:` entries or on `owed: security`. Dispatch each owed Step, then record it. Nothing else clears the block.
- `add before ship: <entry>` → dispatch that Role, then `tier-set ran '<slug>' <entry>`.
- `owed: security` → dispatch `security`, then `route fix '<slug>' security '<why>'`.
- Then run `ship-check` again.

## Other Gates
Every Gate runs `worktree leftovers` and `handoff-lint --contests` (`references/worktrees.md`, `references/contest.md`). Held `needs-ceo` questions join the Gate's own form (`references/ceo-pack.md`).

## Every Gate: the form
Load when the first Gate is due (`aico:pipeline` §4). Gates are **Brief**, **Plan** and **Ship**; feature and fix have no Brief or Plan Gate. Directly before each Gate form run `run-state.mjs ask '<slug>' '<brief|plan|ship>'` (an `auto` Gate shows no form and gets none). Show the CEO a summary of at most 10 lines plus the Handoff paths, naming Roles as `Name (role)`, then open the form `gate:<brief|plan|ship>` (Approve / Change / Stop, single-select, each option with its `run-state gate` `result`: Approve=`passed`, Change=`changed`, Stop=`stopped`; `lead-relay open` refuses any other word) and end with its `STATUS: needs-ceo`. A form's first question names its run slug, so identical forms across runs cannot occur (`lead-relay` refuses a twin of another run's open form). `run-state gate` is refused unless the CEO's recorded answer chose that `result`, once per answer.
- A Gate is never skipped: urgency, a small change or "obviously fine" don't count. A Playbook may skip one only if its own text says so.
- **Auto Gates:** `gates.<brief|plan|ship>` is `auto` → write the summary to `.company/work/<slug>/NN-gate-<brief|plan|ship>.md`, commit it, continue without a form, say so in your next message. An auto Plan Gate still stops with a form when exception requests or a rejected rule are pending. An auto Ship Gate runs the After-approval writes below and their commits first, then pushes the run ref, runs `gh pr create` and stops; it never merges and skips `superpowers:finishing-a-development-branch`. `gates.installs` `auto` runs dependency installs without the Install form, and Role skill installs only under Setup item 19 c.
- **Always a form, whatever the settings say:** `needs-ceo`, Blocking security findings, picks from a report, escalations after the Fix-round limit, design-skill set approval, the migration form, the project-place skill form and the `hash differs` stop form. Messages or handoffs to a client, publishing, reports to authorities and production deploys always ask too.
- The Ship Gate comes before any push, merge, deploy, publish or message to a client, user or authority. Its summary names every optional lane the settings turned off ("skipped by settings: accessibility").

## Plan Gate
- Show the Architect's Core list and Contracts (`aico:contracts`); approved Core goes into `.company/project.md`.
- Show the Plan check block (`references/plan-check.md`), the Parallel plan block (`references/parallel.md` step 3) and one Ruleset line: packs used, Must rules added or changed (signed off by the Architect, or "sign-off skipped: no Must changed"), and any exception requests. Neither block blocks the Gate, except plan-check `block` policy.
- **Ruleset sign-off:** when the Architect's Handoff signs the ruleset off, write `signed-off: <date> (architect)` in `.company/standards.md` and commit it with that Step. Then run `rule-check drift`; exit 1 → the Senior Engineer fixes the binding (no Fix round).
- **Spikes:** if the Architect's Handoff has `## Spikes`, you may dispatch the named engineer before the Plan Gate, Output `.company/work/<slug>/NN-spike-<role>.md`, code under `.company/work/<slug>/spike/`. Spike code never enters the product (no merge, copy or import): commit only the spike Handoff, delete the spike code before the Ship Gate, show the result at the Plan Gate. Estimates: ask the Architect for S/M/L per Module; they are the estimate source for the Finish table.

## Ship Gate: summary and approval
- Feature and fix: after Approve, write the approved Core into `.company/project.md` and commit it (feature: the Architect's Core list; fix has no Architect: its summary lists the Core changes and Approve is the approval). The summary also shows the tier-path lines (`references/tier-path.md` step 9).
- Company types other than `software` (the type lines from Setup item 0): the summary's first line is `Ship means: <ship.meaning>`; every lane in `ship.lanes` runs whatever `pipeline.lanes` says; each item in `ship.checks` without its satisfying Handoff is an open blocker, shown with the check's finding.
- Show `run-guard gate`, `worktree protocheck` (`references/worktrees.md` step 7), `over cap` and `lead peak`; the last two never block.

## After the Ship Gate is approved
Once the `gate` is recorded:
1. `ledger ship '<slug>' <acs> <fix_rounds> <high_blockers>` (plus `--baseline` when baseline runs exist; digits only, from the Brief and the Handoffs' `round:` and `## Blocking`; `<fix_rounds>` is the highest `round:` among Steps that ran before the first Ship Gate answer). Quote the one scorecard line in your message and in `00-summary.md`. A refused or failed `ship` is named and never stops the run.
2. Append to `.company/work/<slug>/00-summary.md`, keeping lines 1-3 (description, blank, `Run:`): what shipped, open nits, follow-ups, and a table `Module | estimate | Steps | Fix rounds`. Commit it with `.company/ledger/<slug>.jsonl` if the product tracks `.company/`. Read-only runs (audit, feedback, usability-test) do the same after the CEO's last decision.
3. Copy every `## Debt` line from this run's reviewer Handoffs, and from a senior-engineer map Handoff that ran in place of research, into `.company/standards.md` `## Debt` (skip duplicates); commit.
4. Append at most 3 one-line Lessons to `.company/lessons.md` (`- <date> <role>: <lesson>`) from Fix rounds, escalations and blocked Steps (a Fix round caused by a rule break always yields one, naming the rule ID); commit; none → write nothing.
5. Push/merge as the CEO chose (`git push <remote> 'refs/heads/<branch>:refs/heads/<branch>'`), using `superpowers:finishing-a-development-branch` if available. Merge a PR only after CI on it is green (`gh pr checks <n> --watch`).
