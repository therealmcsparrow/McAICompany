# Contract: token-ledger v1.9

v1.9 (additive, `docs/adr/0007-contract-minor-versions.md`): a Step id may have three digits, so a run can pass Step 99. `id` for kinds `step`, `replay` and `reflect` is `^\d{2,3}$` (`replay` also `R<n>`, `reflect` also `RT`); two-digit ids stay valid and four digits are refused.

v1.8 (task Context Cap Enforcement, T1; additive, `docs/adr/0007-contract-minor-versions.md`): `add` with `ctx_end` above 95000 still writes the record, then prints `over cap: <kind> <id> <role> ctx_end <n> > 95000` and exits 4 (every refusal, exit 2, runs first and is unchanged; `ctx_end` 0 to 95000 is unchanged). The text `report` prints one line `over cap: <count> steps (max <n>)` right after `not reconciled:` and before any `--baseline` lines from the `notification` records above 95000, only when the count is above 0 (nothing is printed for 0); `report --json` is unchanged. New `agent-ctx` command. Every v1.7 file is a valid v1.8 file.

v1.7 (task Draft Input Folder Case Draft, T11; additive, `docs/adr/0007-contract-minor-versions.md`): every command that takes a run (`add`, `add-mod`, `reconcile`, `import`, `ship`, `scorecard`, `receipt`, `report`, the verdicts and their baseline lists) runs `exactWorkPath` (`work-folder-name` v1.1) after the shape check. A run folder that exists only in another letter case is refused with `refused: wrong letter case` (exit 2, nothing written); a run with no folder in any case behaves as before. Every exact name behaves as before.


Provider: `scripts/ledger.mjs`. Writers: the Lead (`aico:pipeline` after each Step, `aico:brainstorm` after each round); from part M, Reflect `model` mode through `add-mod` only (`aico-mods` v1). Consumers: the Ship Gate cost line (`aico:pipeline` §6), the run scorecard (`aico:pipeline` §6, v1.1), `aico:feedback` (the next 3 runs, the scorecard from v1.1, `parallel-verdict` from v1.3 and `low-path-verdict` from v1.4), the replay and baseline reports (AC15, AC26), and the Cache Tax and Reflect mods (`report --json`).
Sources read: `work-folder-name` v1 `isWorkFolder` (by every command that takes a run, v1.6); `plan-tasks` v1 `readParallel` (by `ship`, v1.3); `tier-sets` v1 `readTierPath` (by `ship`, v1.4); `cost-source` v1 `readCost` and `costText` (by `scorecard`, `ship` and `receipt`, v1.5).

Rationale for the two sources: `docs/adr/0011-token-counts-from-transcripts.md` (Spike S1/S2, `.company/work/optimize-brainstorm/03-spike-ai-data-engineer.md`).
Part M, Fix round 6 (CEO, after SP-M3 `62-spike-ai-data-engineer.md`; still unshipped): keep-warm is cut, so the `keepwarm` kind and its `W<n>` ids are gone; `src: mod` stays for Reflect `model` mode.
v1.1 is additive (minor bump, `docs/adr/0007-contract-minor-versions.md`; rationale `docs/adr/0028-run-timing-from-run-state.md`): Step times on dispatch records, run time, CEO wait and Gate rejects on `ship`, the `scorecard` command, and `report --acs`. The `ship` record is written after the Ship Gate is approved, no longer before it. Every v1 file is a valid v1.1 file and `report` gives the same numbers for it (AC6); the stored `v` stays `1`.
v1.2 is additive (task cheaper-role-models, `docs/adr/0032-plugin-version-ledger-meta.md`): it adds the `meta` kind and the `model-verdict` command. Every v1.1 file is a valid v1.2 file and `report`, `scorecard` give the same numbers for it.
v1.3 is additive (task parallel-cap, `docs/adr/0033-plan-tasks-scheduler.md`): it adds the `par` kind, the optional `floor` key on `meta`, the `parallel-verdict` command, and limits the model verdict's v0.17 side to 0.17.x. Every v1.2 file is a valid v1.3 file and `report`, `scorecard` and `model-verdict` give the same numbers for it.
v1.4 is additive (task low-tier-path, `docs/adr/0034-tier-sets-data-file.md`): it adds the optional meta keys `pb` and `sets`, the optional ship keys `path` and `raised`, ship's tier from the tier record, the scorecard's path segment, the `low-path-verdict` command, and leaves short-path runs out of the parallel verdict. Every v1.3 file is a valid v1.4 file and `report`, `scorecard`, `model-verdict` and `parallel-verdict` give the same numbers for it.

v1.5 is additive (task v020-gate-roadmap, T11): the scorecard gets a last `cost` segment from a recorded source, and the `receipt` command prints what the records hold. Nothing is stored: no record, key or `v` changes, and no cost is ever written to the ledger. Every v1.4 file is a valid v1.5 file; `report`, `model-verdict`, `parallel-verdict` and `low-path-verdict` give the same bytes, and `scorecard` gives the same line plus the last segment.

v1.6 is additive (task build-draft): `run` may be a work folder name (for example `2026-10-30 22.42 - Cache Tax Draft 2`) as well as a legacy slug. Both go through `isWorkFolder`; nothing else decides. A name that fails the check is refused with `refused: run must be a work folder name or a legacy slug` and the text never repeats the name; no file is made. The scorecard and the verdicts compare with the ledger files whose names pass the check and skip the rest. The scorecard file cap is unchanged. Every v1.5 file is a valid v1.6 file and every command gives the same numbers for it; the stored `v` stays `1`.

## Storage
- `.company/ledger/<run>.jsonl`, one JSON object per line. `<run>` = the work folder name of the run (or, for a run started before work-folder-name v1, its task slug), or `brainstorm-<YYYYMMDD-HHMM>` for a brainstorm, `replay-<name>` for a replay, `baseline-<name>` for an imported baseline. Committed with the run's Finish when the product tracks `.company/`; otherwise it stays local. Readers only need the local file.
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
| `run` | a work folder name (`work-folder-name` v1: `isWorkFolder` from `mods/lib/work-folder.mjs`, the one check) or a legacy slug `^[a-z0-9][a-z0-9-]{0,63}$` |
| `kind` | `step \| round \| crossfire \| replay \| total \| ship \| reflect \| meta \| par` (`reflect`: part M, `src: mod` only; `meta`: v1.2; `par`: v1.3, below) |
| `id` | Step `^\d{2,3}$`, round `^R\d{1,3}$`; for `total` the session prefix `^[0-9a-f]{8}$`; `reflect` a Step `^\d{2,3}$` or `RT` (retrospective). A re-dispatch (Fix round, handover) appends a new record with the same `id` |
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

**`meta` record (v1.2)**: keys exactly `v`, `run`, `kind`, `aico`; `aico` matches `^\d{1,3}\.\d{1,3}\.\d{1,3}$`. No other key, and the `aico` key is refused on every other kind. Written only by `ship`, for a run not named `brainstorm-*`, `replay-*` or `baseline-*`, just before the `ship` record, from the `version` of `<plugin root>/.claude-plugin/plugin.json` (at most 64 KiB; missing, unreadable or not that pattern → no `meta` line). `report` and `scorecard` ignore `meta` lines.

`t_start` and `t_ship` come together or not at all; `t_start` later than `t_ship` is refused; `wait` above `t_ship − t_start` is refused. A `ship` without both is **untimed**.

**`par` record (v1.3):** keys exactly `v`, `run`, `kind`, `cap`, `peak`, `waits`, `out`. `cap` integer 1-5 (the effective cap: 1 when the run was sequential), `peak` integer 0-100 (most plan Steps running at once), `waits` integer 0-10000 (plan tasks that waited for an overlap), `out` integer 0-10000 (out-of-list paths, extra plus sibling). Written only by `ship`, for a run not named `brainstorm-*`, `replay-*` or `baseline-*`, after the `meta` line and before the `ship` record, from `readParallel(root, run)` (`plan-tasks` v1) when its state is `on`. State `none` → no line; a reader error → no line, counted in the printed line's `warnings`. `report` and `scorecard` ignore `par` lines. No task ID, path or text.

**`meta` (v1.3):** optional key `floor`, `^\d{1,3}\.\d{1,3}\.\d{1,3}$` = `loadModelFloor(pluginRoot).release` at `ship` time; left out when `release` is `null` or not a version. Keys exactly `v`, `run`, `kind`, `aico`, optional `floor`.

**`meta` (v1.4):** optional `pb` (`feature | fix`) and `sets` (integer 1-999), from `readTierPath(root, run)` (`tier-sets` v1) when its state is `on`; `sets` = its `rev`, left out when 0. Keys exactly `v`, `run`, `kind`, `aico`, optional `floor`, `pb`, `sets`. `pb` and `sets` are refused on every other kind.

**`ship` (v1.4):** optional `path` (`full | short`) and `raised` (`0 | 1`) from the same view; both refused on every other kind. `tier` = the higher of the run-state view's tier and the view's `tier` when the record is `on`. State `none` → none of the four keys (`pb`, `sets`, `path`, `raised`); a reader error, or a view value outside these allow-lists → none of the four keys, counted in the printed line's `warnings`, and `ship` still succeeds. Only integers and enums are stored: no path, text, cause or base commit.


Limits: a line ≤ 512 bytes, a file ≤ 1 MiB; file names are built only from a validated `<run>` or `agent`.

## CLI (Node built-ins only)
`main(args, { now, root, pluginRoot, loadFloor })` is exported: `now` (epoch ms) and `root` (the product root) default to `Date.now()` and `process.cwd()` (v1.1); `pluginRoot` defaults to the plugin folder that holds the script, and `loadFloor` to `loadModelFloor` of `aico-settings` v1.6 (v1.2). Tests inject them, the CLI never does.
| Command | Result |
|---|---|
| `add <run> <kind> <id> <role> <agent> <ctx_end> [tool_uses] [ms]` | (v1.8: `ctx_end` above 95000 → the record is still written, then `over cap: <kind> <id> <role> ctx_end <n> > 95000`, exit 4) appends one `notification` record (the only live write by the Lead; the Lead never types the four counts). v1.1: also writes `t1` = now, and `t0` when `ms` is given. `refused: <reason>` exit 2 on any invalid field, a `t0` before `2026-01-01T00:00:00Z` included |
| `add-mod <run> reflect <id> <in> <cache_write> <cache_read> <out> [model] [ms]` | part M: appends one `src: mod` record with `role: lead`; the only write a mod makes to the ledger. Any kind other than `reflect` (including the cut `keepwarm`) is refused. Refused like `add`. No times |
| `reconcile <run>` | for every `notification` record with no `transcript` record for the same `agent`, reads `<claude-home>/projects/*/*/subagents/agent-<agent>.jsonl` and appends a `transcript` record with the same `run`, `kind`, `id`, `role`, `agent` (never `t0`/`t1`). `<claude-home>` = `CLAUDE_CONFIG_DIR`, else `<home>/.claude` (tests point it at a temp dir, proj.M8). Prints `reconciled: <n>, not reconciled: <m>`; exit 0 |
| `import <file> <key> <run> <acs>` | reads one entry of a counts-only baseline file (shape of `spike/baseline-counts.json`) and writes `<run>.jsonl` with one `total` record (`src: transcript`) and one `ship` record; refuses when `<run>.jsonl` exists |
| `ship <run> <acs> [fix_rounds] [high_blockers] [--baseline <run>,<run>,<run>]` | appends the ship record. v1.1: run **after the Ship Gate is approved**. For a run not named `brainstorm-*`, `replay-*` or `baseline-*` it reads the run-state view of `<run>` (`show`, `run-state` v1.3) and adds the v1.1 keys it can fill (no view, `state: none`, or no passed `ship` Gate → untimed, no `tier`). Then it prints exactly one line: the scorecard (below). v1.2: for those runs it first appends the `meta` line (v1.3: with `floor`), then (v1.3) the `par` line. For a `brainstorm-*`, `replay-*` or `baseline-*` run it adds no v1.1 key, no `meta` line, and prints `ship recorded (excluded run)`. Exit 2 only for a refusal before the write; after the write always exit 0 |
| `scorecard <run> [--baseline <run>,<run>,<run>]` | (v1.1) prints the scorecard line for the run's last `ship` record; `no ledger for <run>` or `no ship record for <run>` otherwise. Always exit 0 for a readable argument list |
| `receipt <run> [--baseline <run>,<run>,<run>]` | (v1.5) prints only what the records of the run hold, one item per line, in this order, each left out when it has no source: `receipt <run>`; `time <d>` (the last `ship` record, timed); `time saved <d> (baseline median <d> of <k> run[s])` (only with `--baseline`, only when at least one named run has a timed `ship` record, only when this run is faster than the median of those); `tokens in <n>, cache_write <n>, cache_read <n>, out <n>` (the sums of the `transcript` and `mod` records, `(<k> unreconciled)` appended when notifications have no counts); `gates <gate> <result>, …` (the `run-state` view's Gate entries); `fix rounds <n>` (the last `ship`); and the cost line, in the scorecard wording, only when `cost-source` recorded one (never `cost: not recorded`). With nothing recorded it prints `no records for <run>`. Read-only, always exit 0 for a readable argument list; a bad `<run>` or flag → `refused: …`, exit 2 |
| `report <run> [--baseline <run>,<run>,<run>] [--acs <n>] [--json] [--live]` | per Step or round and per run, two lines kept apart: **spend** = `in + cache_write + out` and **cache read** = `cache_read`, each in total and per shipped AC, each with its delta against the baseline median. `ctx_end` is shown as "context at end" only. Records with no `transcript` match are counted as `not reconciled: <n>` and left out of both lines. `src: mod` records are listed under their own kind and included in the run totals (AC37). `--acs <n>` (v1.1, integer 0–100000) is the AC count for the per-AC values instead of the last `ship` record's `acs`: the Ship Gate cost line, shown before `ship` exists. **Always exit 0** for a readable ledger (AC16). `--json` and `--live`: below. v1.8: the text report prints `over cap: <count> steps (max <n>)` right after `not reconciled:` and before any `--baseline` lines (`notification` records with `ctx_end` above 95000) only when the count is above 0, and prints nothing for 0; `--json` is unchanged. Output for a v1 file is otherwise unchanged |
| `agent-ctx <agent>… [--json]` | (v1.8) 1 to 8 agent ids, each `^[A-Za-z0-9_-]{1,64}$` and not starting with `-`, else `refused: …`, exit 2 (checked before any file lookup). `--json` prints `{"v":1,"agents":[{"agent":"…","ctx":<int>|null}]}`, order kept; without it, one `<agent> <ctx|?>` line each. `ctx` = the `ctx_end` rule of `reconcile` (the four usage counts of the last request only). The transcript is the first `<claude-home>/projects/*/*/subagents/agent-<agent>.jsonl` (the id whole, host ids such as `a12f28d5ca81d685f`; proven live by T0). A missing file, a link or non-regular file, a path outside `<claude-home>/projects`, a file over 64 MiB, a line over 8 MiB, or any read error → `null`. Reads the four usage counts only and never writes. Exit 0 |
| `brainstorm-report <run> [--against <run>]` | the same two lines per round from round 2 on, the crossfire share, and the deltas |
| `model-verdict [--runs <3-50>]` | (v1.2) prints the one model verdict line (below), read-only. `--runs` is digits only, 3 to 50, default 10; anything else → `refused: …`, exit 2. Otherwise always exit 0 |
| `parallel-verdict [--runs <3-50>]` | (v1.3) prints the one parallel verdict line, read-only. `--runs` digits only, 3 to 50, default 10; anything else → `refused: …`, exit 2. Otherwise always exit 0 |
| `low-path-verdict [--runs <3-50>]` | (v1.4) prints exactly two lines, feature then fix, read-only. `--runs` digits only, 3 to 50, default 10; anything else → `refused: …`, exit 2. Otherwise exit 0 |

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
`scorecard <run> (tier <low|medium|high|unknown>): time <d> (median <d>)` (v1.4: `scorecard <run> (tier <t>, path short): …` when the run's last `ship` has `path: short`; otherwise unchanged)
 · `CEO wait <d> (median <d>)` · `spend/AC <n> (median <n>)` · `fix rounds <n> (median <n>)` · `high blockers <n> (median <n>)` · `gate rejects <n> (median <n>)` · `<label>[ n=<k>]` · `excluded: <n>` · optional `30% target: <delta> vs <b>/AC, <met|missed|not reconciled>` · optional `warnings: <n>` · `cost …` (v1.5, always last).
- `<d>` = `<h>h<mm>m`, or `<m>m` under one hour; an untimed run shows `untimed`; `<n>` = a whole number, or `not reconciled` for spend, or `?`.
- `n=<k>` only when the set has 1 to 4 runs (AC4). An empty set: every `(median …)` reads `(no baseline)` and the `<label>` segment is left out. A median with no member value reads `(median ?)`.
- `30% target` (AC13) only with `--baseline`. `<b>` = the median spend per AC of the baseline runs (the `report --baseline` rule); `<delta>` = this run's spend per AC against `<b>`, rounded like `report` (`-31%`). Baseline quality = the medians of `fix_rounds` and `high_blockers` over the baseline runs whose last `ship` holds both. `met` when spend per AC ≤ 0.70 × `<b>` (unrounded), `fix_rounds` ≤ the baseline Fix-round median and `high_blockers` ≤ the baseline high-blocker median; `not reconciled` when this run's spend per AC is `not reconciled`, no baseline run gives a spend per AC, no baseline run holds both quality values, or this run lacks `fix_rounds` or `high_blockers`; else `missed`.
- `cost …` (v1.5) is the last segment and comes from `cost-source` v1 `readCost(root, run)`, never from the ledger: `cost <usd> USD (approximate, Claude Code telemetry)`, with `<usd>` = micro-USD rounded half up to 2 decimals; a non-zero sum under 0.005 USD reads `cost under 0.01 USD (approximate, Claude Code telemetry)`; no recorded source reads `cost: not recorded`. The number is Claude Code's own estimate from its telemetry; no text calls it a bill, a charge or spend (the ledger's `spend` stays tokens). It is shown for this run only and joins no median. It never blocks a Step or a Gate.
- `warnings: <n>` = skipped lines plus unreadable or over-limit files met while building the line; left out when 0.

## Model verdict (v1.2)
Compares runs of the current release (v0.17) with the runs before it (v0.16), to tell whether the Roles that now run on a lower model cost less to run without more rework. Only `/aico:feedback` runs it; it never blocks a Step or a Gate.
1. **Files.** The scorecard comparison-set rules: at most 500 files, valid names, `brainstorm-*`, `replay-*`, `baseline-*` skipped and not counted. Reads are bounded: a file over 1 MiB is not read, and once 32 MiB have been read in total the remaining files are not read; both count in `not counted`. Newest files first.
2. **Counted run.** The last `ship` is timed and holds `acs` > 0, `fix_rounds` and `high_blockers`; at least one `transcript` record; `not reconciled` is 0; and `readRecord` of `plan-check` v1 neither throws nor returns state `error`. Every other run adds 1 to `not counted`.
3. **Side.** The last `meta` `aico` at 0.17.0 or later and below 0.18.0 → v0.17; no `meta` line → v0.16; any other `meta` (0.18.0 and later included, v1.3) → not counted. Results for v0.17 and older files are unchanged.
4. **Plan check key.** `none` (state none), `off`, or the policy (`warn`/`block`) of state on. The reference is the key of the newest counted v0.17 run by `t_ship`. Counted runs of either side with another key are `excluded`.
5. **Sets.** The newest `--runs` v0.17 runs and the newest `--runs` v0.16 runs that have the reference key.
6. **Values per set.** Spend/AC = Σ spend ÷ Σ `acs` (spend = `in + cache_write + out` of every `transcript` and `mod` record, as `report`). Downgraded spend/AC = the same over records whose `role` is in `loadModelFloor().downgraded`. Medians of `fix_rounds` and `high_blockers` by the scorecard rule. `lower model: <k> of <m>`: v0.17 `transcript` dispatch records of downgraded Roles, and how many of them ran on a model family (`haiku`, `sonnet`, `opus` in the `model` id) below the Role's floor.
7. **State.** `insufficient (n=<k>)` (k = counted v0.17 runs with the reference key) when there are fewer than `--runs` of them, fewer than 5 counted v0.16 runs, either side has no downgraded spend, no Role is downgraded, or the floor cannot be loaded. Else `pass` when downgraded spend/AC is lower than v0.16's, spend/AC is not higher, and both medians are not higher; else `fail`. `roll back` on `fail`: every downgraded Role when a guard (total spend/AC, Fix rounds, high blockers) failed; else the downgraded Roles whose own spend/AC is not lower (a Role with no spend on either side is left out).
8. **The line**, segments joined by ` | `: `model verdict: <state>` · `runs <n> v0.17, <b> v0.16 (plan check <key>)` · `spend/AC <x> (v0.16 <y>)` · `downgraded spend/AC <x> (v0.16 <y>)` · `fix rounds median <x> (v0.16 <y>)` · `high blockers median <x> (v0.16 <y>)` · `downgraded: <roles>` · `lower model: <k> of <m>` · `excluded: <n>` · `not counted: <m>` · on `fail` `roll back: <roles>` · `warnings: <w>` when not 0. Whole numbers; medians with one decimal; `?` where there is no value. The line holds no percent sign, currency or saving word.
- Role names in `downgraded` and `roll back` come only from `loadModelFloor` (and must be keys of its floor table), never from ledger text. Ledger `role` and `model` fields are only compared with that set.
- `warnings` = skipped lines, unreadable or non-file entries, the 500-file limit, and warnings from `loadModelFloor`.

## Parallel verdict (v1.3)
Compares v0.18 runs (capped parallel) with v0.17 runs. Only `/aico:feedback` runs it; it never blocks a Step or a Gate.
1. **Files.** Model verdict rule 1.
2. **Counted run.** Model verdict rule 2, plus at least 2 builder Steps: distinct `id` among `kind: step` records whose `role` is `backend-engineer`, `frontend-engineer`, `desktop-engineer`, `ai-data-engineer` or `game-engineer`. Every other run adds 1 to `not counted`.
3. **Side.** Last `meta` `aico` 0.18.0 or later and a `par` record with `cap` ≥ 2 → v0.18. `aico` 0.17.x → v0.17. Anything else (no `meta`, older, a v0.18 run with no `par` or `cap` 1) → not counted. (v1.4) A run whose last `ship` has `path: short` → not counted.

4. **Keys.** Plan check key: model verdict rule 4. Floor key: `meta` `floor`; for a 0.17.x run without it, `FLOOR_RELEASE_V017` = `0.16.0` (the `release` of `company/model-floor.json` at tag v0.17.0). Reference: the plan check key of the newest counted v0.18 run by `t_ship`, and the current `loadModelFloor().release`. Counted runs with another key → `excluded`.
5. **Sets.** The newest `--runs` runs of each side with the reference keys.
6. **Values per set.** Time = median of `t_ship − t_start − wait` (seconds); wall = median of `t_ship − t_start`; medians of `fix_rounds`, `high_blockers` and Gate rejects (`rej_brief + rej_plan + rej_ship`, an absent key counts 0) by the scorecard rule; spend/AC = Σ spend ÷ Σ `acs` (model verdict rule 6); v0.18 only: medians of `par` `out` and `cap`. Medians are exact (an even count averages the two middle values) and are compared unrounded; only the printed line rounds.
7. **State.** `insufficient (n=<k>)` (k = the size of the smaller set) when either set has fewer than `--runs` runs or the floor cannot be loaded. Else `pass` when v0.18 time ≤ 0.75 × v0.17 time (unrounded), the Fix-round, high-blocker and Gate-reject medians are not higher, v0.18 spend/AC ≤ 1.10 × v0.17 spend/AC, and the out-of-list median is 0. Else `fail`. An error never prints as `pass`.
8. **The line**, segments joined by ` | `: `parallel verdict: <state>` · `runs <a> v0.18, <b> v0.17 (plan check <key>, floor <release>)` · `time minus CEO wait median <d> (v0.17 <d>)` · `wall clock median <d> (v0.17 <d>)` · `fix rounds median <x> (v0.17 <y>)` · `high blockers median <x> (v0.17 <y>)` · `gate rejects median <x> (v0.17 <y>)` · `spend/AC <x> (v0.17 <y>)` · `out-of-list median <x>` · `cap median <x>` · `excluded: <n>` · `not counted: <m>` · on `fail` only: `next step: set pipeline.parallel_cap to 5` when the cap median is below 5, else `next step: set pipeline.dispatch to sequential` · `warnings: <w>` when not 0. `<d>` as in the scorecard; whole numbers; medians with one decimal; `?` where there is no value. No percent sign, currency or saving word.

## Low-path verdict (v1.4)
Compares runs on the short path (v0.19) with comparable runs before it, to tell whether a low-tier run is faster without more rework. Only `/aico:feedback` runs it; it never blocks a Step or a Gate. Per Playbook `<pb>`:
1. **Files.** Model verdict rule 1.
2. **Counted run.** Model verdict rule 2.
3. **Playbook.** `meta.pb`; a run with no `meta` or `meta.aico` below 0.19.0: a `step` record with role `product-manager` → feature; else the `step` record with the lowest `id` has role `qa` → fix; else not counted.
4. **Side.** short = `meta.aico` 0.19.0 or later and ship `path: short`. before = ship `tier: low` and ((no `meta` or `meta.aico` below 0.19.0) or (`meta.aico` 0.19.0 or later with ship `path: full`)) (CEO, Plan Gate Q1 b, 2026-10-28). Anything else → not counted.
5. **Keys.** Plan check key (model verdict rule 4); floor key (`meta.floor`; 0.17.x without it → `FLOOR_RELEASE_V017`; else `none`); cap key (the last `par` `cap`, or `none`). Reference = the keys of the newest counted short run of `<pb>` by `t_ship`. Another key → `excluded`.
6. **Sets.** The newest `--runs` runs of each side.
7. **Values.** Time = median of `t_ship − t_start − wait`; medians of `fix_rounds`, `high_blockers` and Gate rejects (`rej_brief + rej_plan + rej_ship`, an absent key counts 0); spend: feature Σ spend ÷ Σ `acs` (spend/AC), fix Σ spend ÷ runs (spend/run); raised = short runs with `raised: 1`. Medians are exact (an even count averages the two middle values) and compared unrounded.
8. **State.** `insufficient (n=<k>)` (k = the smaller set) when either set has fewer than `--runs` runs or the floor cannot be loaded. Else `pass` when short time ≤ 0.75 × before time, the three medians are not higher, spend is not higher, and raised ≤ 0.20 × short runs. Else `fail`. An error never prints as `pass`.
9. **The line**, segments joined by ` | `: `low-path verdict <pb>: <state>` · `runs <a> short, <b> before (plan check <key>, floor <r>, cap <c>)` · `time minus CEO wait median <d> (before <d>)` · `fix rounds median <x> (before <y>)` · `high blockers median <x> (before <y>)` · `gate rejects median <x> (before <y>)` · `spend/AC <x> (before <y>)` (feature) or `spend/run <x> (before <y>)` (fix) · `raised <k> of <a>` · `excluded: <n>` · `not counted: <m>` · on `fail` only `roll back: set pipeline.short_path to off` · `warnings: <w>` when not 0. `<d>` as in the scorecard; spend in whole numbers; medians with one decimal; `?` where there is no value. No percent sign, currency or saving word.
- `not counted`, `warnings` and the floor state are shared by both lines (one pass over the files). `--runs` is the only argument; no ledger text is printed.

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
- A v1.1 reader skips a v1.2 `meta` line with one `warning: line <n> skipped`; its numbers stay the same (tested against the v1.1 script).
- A v1.2 reader skips `par` lines and a `meta` line with `floor`, each with `warning: line <n> skipped`; its `report` and `scorecard` numbers stay the same. Its `model-verdict` then reads such a v0.18 run as v0.16 (no `meta`); this matters only after installing an older tag.
- A v1.3 reader skips `meta` lines with `pb`/`sets` and `ship` lines with `path`/`raised`, each with `warning: line <n> skipped`; a v0.19 run then reads as unshipped there. This matters only after installing an older tag.
- A v1.1 reader reads every v1 file; a v1 `ship` is untimed and counts in `excluded`.
- A v1 reader (an earlier tag after a rollback) skips v1.1 lines that hold `t0`/`t1` or v1.1 `ship` keys, each with `warning: line <n> skipped`. Spend from reconciled runs stays the same (transcript records carry no v1.1 key); per-AC values of v1.1 runs read `n/a` there.

- A v1.4 reader (an earlier tag after a rollback) has no `receipt` command and prints no cost segment; every number it prints stays the same.

## Error cases
- Missing file → `report` prints `no ledger for <run>` and exits 0 (`--json`: `rows: []`, `warnings: ["no ledger"]`).
- A bad line in an existing file → `report` skips it, prints `warning: line <n> skipped`, exits 0. `scorecard` and `ship` count it under `warnings: <n>` instead, so they still print one line.
- `reconcile` with an unreadable `<claude-home>` → `not reconciled: <all>`, exit 0.
- No `<usage>` block for a dispatch (a foreground Agent call; Spike S1 saw none, shape unverified) → the Lead still runs `add` with `ctx_end` `0`, so `reconcile` can find the agent; `report` shows `0` as "unknown", never as zero context. The record gets `t1` and no `t0`.
- Run-state missing, unreadable, or without a passed `ship` Gate → `ship` writes an untimed record and still prints the line, exit 0.
