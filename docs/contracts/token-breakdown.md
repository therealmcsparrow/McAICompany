# Contract: token-breakdown v1

New Contract (task P20261112.000001/02-feature). Provider: `scripts/token-breakdown.mjs` (Node built-ins only; read-only, writes nothing, no network). Consumer: the ai-data-engineer, who runs it once and writes the run's breakdown report; the CEO reads that report at the Ship Gate. Uses `token-ledger` v1.12 (`report <run> --json` through the CLI; the ledger file walk and `validateRecord` read-only; the subagent transcript path rule of `reconcile`), `lead-handoff` v2.2 (`lead-context.json` `session`, `handover` events' `session`, read-only), `work-folder-name` v3.0 (`isRunSlug`, `exactWorkPath`).
Not a ledger command and not a ledger record: no estimate, no new stored number.

## CLI
- `token-breakdown.mjs [--runs <n>] [--json]`: `n` 1-50, default 10. Prints Markdown (default) or one JSON object. Exit 0; a bad flag → `refused: usage`, exit 2.
- `<claude-home>` = `CLAUDE_CONFIG_DIR`, else `<home>/.claude` (tests point it at a temp dir).

## Runs (AC1)
- Shipped run = a ledger file with at least one `ship` record, name not `brainstorm-*`, `replay-*`, `baseline-*`. Newest first by the last `ship` record time; the first `n`. Output names the count found and every run ID.

## Spend split (AC1)
- Per run: subagent rows = `report <run> --json` rows; per Role = the sum of row `spend` by `role`; subagent total = `totals.spend`. The breakdown prints `report`'s numbers, never recomputed ones, and checks Σ Role = `totals.spend` (a mismatch is printed as `mismatch`, never hidden).
- Lead: requests of the Lead transcripts whose request time lies between the earliest and the latest record time of the run's ledger file. Lead transcripts = `<claude-home>/projects/*/<uuid>.jsonl` whose first 12 hex of SHA-256(`<uuid>`) equals the `session` in the run folder's `lead-context.json` or in a `handover` event of its `lead-handover.jsonl`. Spend = in + cache write + out per request (the `report` spend rule), each request once (the `reconcile` request-key rule). No session or no file → Lead `not measurable from records: <reason>`.

## Categories (AC2)
- Per transcript (each subagent dispatch and the Lead window), requests in file order. Context of a request = in + cache write + cache read. Added(n) = context(n) − context(n−1), credited to the category of request n−1's tool calls. Carried(n) = Added(n) × the number of later requests in the same transcript (the cache reads it causes).
- Category of a request's tool calls: `file reads` (`Read`); `test output` (`Bash`/`PowerShell` whose `input.command` matches the test pattern: `node --test`, `npm test`, `npm run test`, `test-run.mjs`); `command output` (other `Bash`/`PowerShell`); `other tool results` (any other tool); `mixed` (more than one of these in one request); request 1 → `prompt`. No tool call → `reply`. Added(n) below 0 (a compaction or clear) → the request is not credited and counted under `skipped`.
- Shares = category sum ÷ all credited, for Added and for Carried. A run whose transcripts are gone, oversized or unreadable is listed under `not measurable from records` with the reason and left out of the shares.

## Ranking (AC3)
- Last line: `Top sink: <category> <p>% of carried tokens (<runs> runs)`. Then `Test-output tail hook: yes` when `test output` ranks first or second by Carried, else `no`, with the two shares that decided it.

## Reading transcripts
- Transcript text is data (agentsec.M-SEC1). Used fields only: `type`, `requestId`/`message.id`/`uuid`, `timestamp`, `message.usage` (the four counts), `message.content[].type`, `.name` and, for `Bash`/`PowerShell`, `.input.command` matched against the test pattern only. Command text, file paths and tool results are never printed, stored or echoed (GDPR Art. 5(1)(c)).
- Limits as `reconcile`: a file over 64 MiB or a line over 8 MiB → that transcript is `not measurable (size)`.

## Error cases
- No ledger folder or no shipped run → prints `runs: 0` and `not measurable from records: no shipped runs`, exit 0.
- `report` fails for a run → that run is listed with `report failed`, left out, exit 0.
