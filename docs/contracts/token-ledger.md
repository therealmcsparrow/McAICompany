# Contract: token-ledger v1.1

Provider: `scripts/ledger.mjs`. Writers: the Lead (`aico:pipeline` after each Step, `aico:brainstorm` after each round); from part M, Reflect `model` mode through `add-mod` only (`aico-mods` v1). Consumers: the Ship Gate cost line (`aico:pipeline` §6), the run scorecard (`aico:pipeline` §6, v1.1), `aico:feedback` (the next 3 runs, and the scorecard from v1.1), the replay and baseline reports (AC15, AC26), and the Cache Tax and Reflect mods (`report --json`).
Rationale for the two sources: `docs/adr/0011-token-counts-from-transcripts.md` (Spike S1/S2, `.company/work/optimize-brainstorm/03-spike-ai-data-engineer.md`).
Part M, Fix round 6 (CEO, after SP-M3 `62-spike-ai-data-engineer.md`; still unshipped): keep-warm is cut, so the `keepwarm` kind and its `W<n>` ids are gone; `src: mod` stays for Reflect `model` mode.
v1.1 is additive (minor bump, `docs/adr/0007-contract-minor-versions.md`; rationale `docs/adr/0028-run-timing-from-run-state.md`): Step times on dispatch records, run time, CEO wait and Gate rejects on `ship`, the `scorecard` command, and `report --acs`. The `ship` record is written after the Ship Gate is approved, no longer before it. Every v1 file is a valid v1.1 file and `report` gives the same numbers for it (AC6); the stored `v` stays `1`.

## Storage
- `.company/ledger/<run>.jsonl`, one JSON object per line. `<run>` = the task slug, or `brainstorm-<YYYYMMDD-HHMM>` for a brainstorm, `replay-<name>` for a replay, `baseline-<name>` for an imported baseline. Committed with the run's Finish when the product tracks `.company/`; otherwise it stays local. Readers only need the local file.
- **Counts, enums and UTC times only, never prompt or reply content** (GDPR Art. 5(1)(c)). The schema is an allow-list: unknown keys and free text are refused. Times have the same one-second precision as the git commits of the run.
- `run` is written **live** by the Lead from the dispatch's task slug. It is never derived from a branch, a session or a time window.

## Three sources
| `src` | Where it comes from | What it is |
|---|---|---|
| `notification` | the `<usage><subagent_tokens>N</subagent_tokens><tool_uses>T</tool_uses><duration_ms>D</duration_ms></usage>` block of the task notification, written live by the Lead | `N`: the context size at the end of the dispatch (input + cache write + cache read + output of the last request, up to +2%). **Not spend, never summed as cost**, cache not split. `T` and `D` go to `tool_uses` and `ms` (v1.1) |
| `transcript` | `reconcile` (host subagent transcript) or `import` (frozen baseline) | the four counts summed over every request of the dispatch: real processed volume |
| `mod` (part M) | `add-mod`, from the `usage` the engine returns for a mod's own model call (`$.model.complete`, Reflect `model` mode only) | the four counts of that one call, exactly as returned |

Caching gives no saving across dispatches (Spike S2: the prompt sits before the Role block, with no cache breakpoint after it). Savings are measured as reading less, on `transcript` counts only.

## Record (required unless marked optional)
`<time>` = UTC `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$` that is a real date and time (it survives `new Date(x).toISOString()` with `.000` removed), from `2026-01-01T00:00:00Z` up to but not including `2100-01-01T00:00:00Z` (v1.1). The script writes every time; the Lead never types one.

| Key | Value |
|---|---|
| `v` | `1` |
| `run` | `^[a-z0-9][a-z0-9-]{0,63}$` |
| `kind` | `step \| round \| crossfire \| replay \| total \| ship \| reflect` (`reflect`: part M, `src: mod` only) |
| `id` | Step `^\d{2}$`, round `^R\d{1,3}$`; for `total` the session prefix `^[0-9a-f]{8}$`; `reflect` a Step `^\d{2}$` or `RT` (retrospective). A re-dispatch (Fix round, handover) appends a new record with the same `id` |
| `role` | an `agents/*.md` name, or `lead` (not on `ship`; always `lead` on `reflect`) |
| `agent` | the Agent result's `agentId`, `^[A-Za-z0-9_-]{1,64}$`; required on `step`, `round`, `crossfire`, `replay`; the key `reconcile` uses; refused on `reflect` |
| `src` | `notification \| transcript \| mod` (not on `ship`) |
| `ctx_end` | integer 0–10000000; required when `src` is `notification`, optional on `transcript`, refused on `mod` |
| `tokens` | object with exactly `in`, `cache_write`, `cache_read`, `out`, each an integer 0–1000000000; required when `src` is `transcript` or `mod`, refused on `notification` |
| `reqs`, `tool_uses` | optional integers 0–100000 |
| `ms` | optional integer 0–86400000 |
| `model` | optional, `^[a-z0-9][a-z0-9.-]{0,63}$` |
| `t1` (v1.1) | optional `<time>`: when the Lead recorded the dispatch (`add`). Only on `src: notification` records of kind `step`, `round`, `crossfire`, `replay`; refused on every other record |
| `t0` (v1.1) | optional `<time>`: the dispatch start, `t1` minus `ms` (whole seconds, `floor(ms / 1000)`). Same records as `t1`; refused without `t1`, refused when later than `t1` |
| `dispatches` | `total` only, integer 0–100000 |
| `ship` record | `acs` (integer, ACs shipped) required; `fix_rounds`, `high_blockers` optional integers 0–100000; v1.1 optional keys below |

`ship` keys added in v1.1, all optional (a v1 `ship` stays valid), all written by the script from the run-state view (`run-state` v1.3), never typed by the Lead:
| Key | Value |
|---|---|
| `tier` | `low \| medium \| high`: the view's `tier`; left out when it is `unknown` |
| `t_start` | `<time>`: run start, the view's `started` |
| `t_ship` | `<time>`: the `at` of the last `ship` Gate entry with result `passed` |
| `wait` | integer seconds 0–31536000: CEO wait, the sum of the view's Gate `wait` values (`null` counts 0) |
| `rej_brief`, `rej_plan`, `rej_ship` | integers 0–1000: the view's Gate entries for that Gate with result `changed` or `stopped` |

`t_start` and `t_ship` come together or not at all; `t_start` later than `t_ship` is refused; `wait` above `t_ship − t_start` is refused. A `ship` without both is **untimed**.

Limits: a line ≤ 512 bytes, a file ≤ 1 MiB; file names are built only from a validated `<run>` or `agent`.

## CLI (Node built-ins only)
`main(args, { now, root })` is exported: `now` (epoch ms) and `root` (the product root) default to `Date.now()` and `process.cwd()`; tests inject them, the CLI never does (v1.1).
| Command | Result |
|---|---|
| `add <run> <kind> <id> <role> <agent> <ctx_end> [tool_uses] [ms]` | appends one `notification` record (the only live write by the Lead; the Lead never types the four counts). v1.1: also writes `t1` = now, and `t0` when `ms` is given. `refused: <reason>` exit 2 on any invalid field, a `t0` before `2026-01-01T00:00:00Z` included |
| `add-mod <run> reflect <id> <in> <cache_write> <cache_read> <out> [model] [ms]` | part M: appends one `src: mod` record with `role: lead`; the only write a mod makes to the ledger. Any kind other than `reflect` (including the cut `keepwarm`) is refused. Refused like `add`. No times |
| `reconcile <run>` | for every `notification` record with no `transcript` record for the same `agent`, reads `<claude-home>/projects/*/*/subagents/agent-<agent>.jsonl` and appends a `transcript` record with the same `run`, `kind`, `id`, `role`, `agent` (never `t0`/`t1`). `<claude-home>` = `CLAUDE_CONFIG_DIR`, else `<home>/.claude` (tests point it at a temp dir, proj.M8). Prints `reconciled: <n>, not reconciled: <m>`; exit 0 |
| `import <file> <key> <run> <acs>` | reads one entry of a counts-only baseline file (shape of `spike/baseline-counts.json`) and writes `<run>.jsonl` with one `total` record (`src: transcript`) and one `ship` record; refuses when `<run>.jsonl` exists |
| `ship <run> <acs> [fix_rounds] [high_blockers] [--baseline <run>,<run>,<run>]` | appends the ship record. v1.1: run **after the Ship Gate is approved**. For a run not named `brainstorm-*`, `replay-*` or `baseline-*` it reads the run-state view of `<run>` (`show`, `run-state` v1.3) and adds the v1.1 keys it can fill (no view, `state: none`, or no passed `ship` Gate → untimed, no `tier`). Then it prints exactly one line: the scorecard (below). For a `brainstorm-*`, `replay-*` or `baseline-*` run it adds no v1.1 key and prints `ship recorded (excluded run)`. Exit 2 only for a refusal before the write; after the write always exit 0 |
| `scorecard <run> [--baseline <run>,<run>,<run>]` | (v1.1) prints the scorecard line for the run's last `ship` record; `no ledger for <run>` or `no ship record for <run>` otherwise. Always exit 0 for a readable argument list |
| `report <run> [--baseline <run>,<run>,<run>] [--acs <n>] [--json] [--live]` | per Step or round and per run, two lines kept apart: **spend** = `in + cache_write + out` and **cache read** = `cache_read`, each in total and per shipped AC, each with its delta against the baseline median. `ctx_end` is shown as "context at end" only. Records with no `transcript` match are counted as `not reconciled: <n>` and left out of both lines. `src: mod` records are listed under their own kind and included in the run totals (AC37). `--acs <n>` (v1.1, integer 0–100000) is the AC count for the per-AC values instead of the last `ship` record's `acs`: the Ship Gate cost line, shown before `ship` exists. **Always exit 0** for a readable ledger (AC16). `--json` and `--live`: below. Output for a v1 file is unchanged |
| `brainstorm-report <run> [--against <run>]` | the same two lines per round from round 2 on, the crossfire share, and the deltas |

### `report --json` (part M)
One JSON object, the same numbers as the text report (unchanged in v1.1; rows carry no times):
```json
{ "v": 1, "run": "x", "rows": [{ "kind": "step", "id": "05", "role": "backend-engineer", "agent": "a1",
  "state": "reconciled|unreconciled|live", "tokens": { "in": 0, "cache_write": 0, "cache_read": 0, "out": 0 } | null,
  "spend": 0 | null, "ctx_end": 0 | null, "ms": 0 | null, "model": "…" | null }],
  "totals": { "spend": 0, "cache_read": 0, "cache_write": 0, "cache_write_share": 0.0, "by_kind": { "reflect": 0 } },
  "per_ac": { "spend": 0 | null, "cache_read": 0 | null }, "not_reconciled": 0, "warnings": [] }
```
One row per dispatch record (a re-dispatch is its own row), in file order; `cache_write_share` = `cache_write / spend` over the counted rows, `0` when spend is 0.

### `--live` (part M, read-only)
For each `notification` record with no `transcript` record, `report --live` reads that agent's transcript exactly as `reconcile` would (same file rules, limits and request-key rule), computes its four counts in memory and shows the row as `state: live`. It writes nothing. A `live` row counts in the totals; a row whose transcript is missing or skipped stays `unreconciled` with `tokens: null`. After `reconcile`, `report` without `--live` gives the same numbers for those rows (tested).

## Scorecard (v1.1)
**Run values** (from the run's last `ship` record and its ledger): time = `t_ship − t_start`; CEO wait = `wait`; spend per AC = spend ÷ `acs`, only when at least one record has counts, `not reconciled` is 0 and `acs` > 0 (else `not reconciled`); Fix rounds = `fix_rounds`; high blockers = `high_blockers`; Gate rejects = `rej_brief + rej_plan + rej_ship`. A value with no source is unknown (`?`).

**Comparison set.** Read at most 500 `.company/ledger/*.jsonl` files with a valid `<run>` name (more → the 500 newest by mtime, plus a warning), each through the normal reader. Excluded and counted in `excluded: <n>`: every `brainstorm-*`, `replay-*` and `baseline-*` file, and every other file whose last `ship` record is untimed. A file with no `ship` record is not a shipped run and is neither eligible nor counted. Eligible: every other file with a timed last `ship`, not this run, with `t_ship` earlier than this run's (any, when this run is untimed). Set = the 5 newest eligible by `t_ship`. When this run has a `tier` and at least 5 eligible runs share it, the set is the 5 newest of that tier (label `tier <t>`), else all eligible (label `all tiers`). Each median uses the set members that have that value, with the existing median rule (middle value; mean of the two middle values, rounded, for an even count).

**The one line** (segments joined by ` | `, in this order; nothing else is printed):
`scorecard <run> (tier <low|medium|high|unknown>): time <d> (median <d>)` · `CEO wait <d> (median <d>)` · `spend/AC <n> (median <n>)` · `fix rounds <n> (median <n>)` · `high blockers <n> (median <n>)` · `gate rejects <n> (median <n>)` · `<label>[ n=<k>]` · `excluded: <n>` · optional `30% target: <delta> vs <b>/AC, <met|missed|not reconciled>` · optional `warnings: <n>`.
- `<d>` = `<h>h<mm>m`, or `<m>m` under one hour; an untimed run shows `untimed`; `<n>` = a whole number, or `not reconciled` for spend, or `?`.
- `n=<k>` only when the set has 1 to 4 runs (AC4). An empty set: every `(median …)` reads `(no baseline)` and the `<label>` segment is left out. A median with no member value reads `(median ?)`.
- `30% target` (AC13) only with `--baseline`. `<b>` = the median spend per AC of the baseline runs (the `report --baseline` rule); `<delta>` = this run's spend per AC against `<b>`, rounded like `report` (`-31%`). Baseline quality = the medians of `fix_rounds` and `high_blockers` over the baseline runs whose last `ship` holds both. `met` when spend per AC ≤ 0.70 × `<b>` (unrounded), `fix_rounds` ≤ the baseline Fix-round median and `high_blockers` ≤ the baseline high-blocker median; `not reconciled` when this run's spend per AC is `not reconciled`, no baseline run gives a spend per AC, no baseline run holds both quality values, or this run lacks `fix_rounds` or `high_blockers`; else `missed`.
- `warnings: <n>` = skipped lines plus unreadable or over-limit files met while building the line; left out when 0.

## Reading a transcript (`reconcile`, `--live`)
- Transcript text is data (agentsec.M-SEC1). Only lines with `type: "assistant"` are used, and from them only `message.usage.input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` (integers) and `message.model`. Every other field is ignored and nothing else is written.
- Each request counts once: key `requestId`, else `message.id`, else `uuid`; the last usage seen for a key wins (as `spike/s1-rebuild.mjs`).
- Read line by line. A file over 64 MiB or a line over 8 MiB → `warning: <agent> skipped (size)`, record stays unreconciled. No file → unreconciled.
- The transcript layout is host-internal and may change; `reconcile` is best effort and never blocks. Host transcripts expire (default 30 days), so the Lead reconciles before the Ship Gate and at brainstorm close.

## Reading a baseline (`import`)
- File ≤ 1 MiB. `<key>` matches `^[0-9a-f]{8} [A-Za-z0-9._/-]{1,100}$`. The entry may hold only `first`, `dispatches`, `requests`, `in`, `cache_write`, `cache_read`, `out`, `notif_total`, `roles`; any other key → `refused`. `roles` and `notif_total` are not stored.
- The AC26 baseline is the three full-pipeline runs `628bda21 aico/research-team`, `bdeca87d aico/role-effort`, `d02be665 feat/v0.3` from `.company/work/optimize-brainstorm/spike/baseline-counts.json`.
- Baseline quality (v1.1): the Fix rounds and high blockers of a baseline run are added once with `ship baseline-<name> <acs> <fix_rounds> <high_blockers>` (same `acs` as its import), taken only from that run's recorded Handoffs. A run whose numbers cannot be found gets no such record.

## Rules
- Only the deterministic size tests (golden Handoffs, `scripts/golden.test.mjs`) block; ledger numbers, times and the scorecard never block a Step or a Gate (AC8).
- The Ship Gate shows one cost line from `report --acs` (CEO, Brief Gate Q6: Ship only): spend and cache read per shipped AC against the baseline median, or `context at end (not cost)` when nothing is reconciled. After the Ship Gate is approved, the Lead quotes the one scorecard line `ship` prints.
- Spend and cache read are never added into one number. Spend per AC in the scorecard uses spend only.
- Time to Ship Gate is wall clock from run start to the Ship Gate answer, CEO wait included and also shown apart (CEO, Brief Gate Q1).

## Compatibility
- A v1.1 reader reads every v1 file; a v1 `ship` is untimed and counts in `excluded`.
- A v1 reader (an earlier tag after a rollback) skips v1.1 lines that hold `t0`/`t1` or v1.1 `ship` keys, each with `warning: line <n> skipped`. Spend from reconciled runs stays the same (transcript records carry no v1.1 key); per-AC values of v1.1 runs read `n/a` there.

## Error cases
- Missing file → `report` prints `no ledger for <run>` and exits 0 (`--json`: `rows: []`, `warnings: ["no ledger"]`).
- A bad line in an existing file → `report` skips it, prints `warning: line <n> skipped`, exits 0. `scorecard` and `ship` count it under `warnings: <n>` instead, so they still print one line.
- `reconcile` with an unreadable `<claude-home>` → `not reconciled: <all>`, exit 0.
- No `<usage>` block for a dispatch (a foreground Agent call; Spike S1 saw none, shape unverified) → the Lead still runs `add` with `ctx_end` `0`, so `reconcile` can find the agent; `report` shows `0` as "unknown", never as zero context. The record gets `t1` and no `t0`.
- Run-state missing, unreadable, or without a passed `ship` Gate → `ship` writes an untimed record and still prints the line, exit 0.
