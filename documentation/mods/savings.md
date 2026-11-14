# Savings

## In short
Savings shows how many tokens a Step uses in the current run, next to the runs from before the guards existed. Open it with `/aico-savings`.

## How it works
1. Type `/aico-savings` during a run. The pane opens beside the chat.
2. It shows the median real tokens per Step of the active run.
3. Next to it is the baseline: the same median over runs shipped before the first aico version with guards.
4. Read the state words when there is no number (see Technical details).

## Technical details
- **Sources.** Real ledger counts only: the run from `ledger.mjs report <run> --json`, the baseline from `ledger.mjs baseline --before <version> --json`. Both are read-only.
- **State words.** `no data`: the ledger is empty or no run before the guards exists. `unmeasured`: a Step has no count. `unknown`: the runs have no version record, so none is counted as baseline. The pane never shows `NaN`.
- **Estimates.** An estimate, if shown, sits in its own field labelled `estimate`. It is never mixed into the real counts.
- **What it costs.** It runs in the Lead session only, makes no model call and no outbound call. You can switch it off with `mods.savings.enabled` or on the [Switchboard](switchboard.md).
- **Claims.** The pane compares your own runs. It does not promise a saving.

Back to [Mods](README.md).
