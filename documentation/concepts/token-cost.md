# Token cost

## In short
aico counts how many tokens each Step used and shows you one line at the end of a run. It only counts. It never stores what was said. The numbers are a baseline to measure changes against, and the scorecard never blocks anything.

## How it works
1. Each Step's token counts are added to a ledger file in your repo.
2. At the Ship Gate the Lead shows one cost line.
3. **→ Ship Gate** After you approve, the Lead prints one scorecard line, each figure beside the median of the last 5 shipped runs.
4. `/aico:feedback` compares the last three runs.

## Technical details
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

### Cost from telemetry
The scorecard shows a cost segment only when a cost is recorded, and never estimates one. The number is Claude Code's approximate cost from telemetry, not a bill. aico reads an OpenTelemetry export file you set up, matched by session id inside the run window.

**Setup.**
1. Run an OpenTelemetry Collector with a minimal YAML: an OTLP receiver on `127.0.0.1` only, and a `file` exporter to `<MCSPARROW_HOME or ~/.mcsparrow>/otel/metrics.jsonl`. No rotation, no headers, no tokens.
2. Set the Claude Code telemetry variables in your own shell or in `~/.claude/settings.json`, never in a repository file.
3. Export metrics only. Do not set the `OTEL_LOG_*` content flags.
4. Keep delta temporality, which is the default.

The Collector `file` exporter is alpha. The file holds account attributes that aico never reads.
