# `/aico:feedback`

`/aico:feedback <reports: path, paste or export>`

## In short
**What it does.** Turns user feedback, reviews and support reports into ranked, de-duplicated fix and feature proposals you pick from. It builds nothing.

**When to use it.** You have a pile of user input and want it triaged into a short list of things worth doing.

**Help:** `/aico:feedback help` (or `--help`) explains the command without running it.

## How it works
1. **Support** clusters the reports (and stops to suggest [`/aico:incident`](incident.md) if a cluster looks security-related). The report also gets the verdict sections listed under Technical details.
2. **Product Manager** ranks the top 5 against your success metric and proposes a fix or feature for each. **→ Brief Gate** (you pick).
3. Lessons: each lesson from the reports or the run is filed only after you accept that one lesson, and it needs a class and a target (`lessons` v2.0). A `mechanical` lesson, one a script could catch, proposes a check (target `check: script|lint|test <name>`). A `judgement` lesson needs a reader's call and goes to `.company/standards.md`, `skills/review/SKILL.md` or a file under `skills/review/references/`. Lessons never go to `CLAUDE.md`, `AGENTS.md` or an agent prompt; the script refuses those targets.
4. The Lead tells you which `/aico:fix` and `/aico:feature` runs to start — it never starts them itself.

## Technical details
### Report sections
If runs have a token ledger, the report also compares the cost of the last three runs under `## Cost`, and shows the [run scorecard](../concepts/receipts-and-reports.md) medians. The scorecard line itself is printed after the Ship Gate of any build run and never blocks it.
- `## Plan check`: one verdict line from `plan-check-verdict.mjs verdict`, quoted unchanged (see [Plan check](../concepts/plans.md)). If the verdict cannot be read, the error is quoted as it is and the run goes on.
- `## Model`: one line from `ledger.mjs model-verdict`, quoted unchanged. The line starts `model verdict:` with `pass`, `fail` or `insufficient (n=<k>)`, then run counts, spend per AC, Fix rounds and high blockers for v0.17 and v0.16 runs, and on `fail` the Roles to roll back. It never stops a Step or a Gate; an error is quoted as it is and is not a pass.
- `## Parallel`: one line from `ledger.mjs parallel-verdict`, quoted unchanged. It starts `parallel verdict:` with `pass`, `fail` or `insufficient (n=<k>)`, then run counts, time, Fix rounds, high blockers, Gate rejects, spend per AC, out-of-list and cap medians. On `fail` it ends with `next step: set pipeline.parallel_cap to 5`, or `next step: set pipeline.dispatch to sequential` when the cap median is already 5. It never stops a Step or a Gate; an error is quoted as it is and is not a pass. See [Parallel Steps](../concepts/parallel-steps.md).
- `## Low path`: the two lines from `ledger.mjs low-path-verdict --runs 10`, feature then fix, quoted unchanged. Each starts `low-path verdict <feature|fix>:` with `pass`, `fail` or `insufficient (n=<k>)`, then run counts, time, Fix rounds, high blockers, Gate rejects, spend and how many short runs were raised. On `fail` it ends with `roll back: set pipeline.short_path to off`. It never stops a Step or a Gate; an error is quoted as it is and is not a pass. See [Short path](../concepts/risk-tier.md).
- `## Cited`: every line printed by `cited.mjs report --runs 10`, unchanged. See [The never-cited report](../concepts/receipts-and-reports.md).

**You get.** `.company/work/<slug>/feedback-report.md` — clustered, ranked proposals. Builds nothing.

**Example.** `/aico:feedback ./support-tickets-oct.csv`
