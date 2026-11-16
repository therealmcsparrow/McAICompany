# Contract: step-key v1.0

Provider: `scripts/step-key.mjs` (Node built-ins and `git` only; plan task P20261116.000003-T16). Consumers: the Lead through `aico:pipeline` (`before`, `reuse`, `after` around every Step), `/aico:feedback` (`stats`). The term is "stepKey".
Rationale: a versioned key that decides whether a Fix-round Step reuses an earlier Handoff instead of being dispatched. v1.0 reuses on a hit (CEO, Plan Gate 2026-11-16), although the prototype measured only an upper bound of would-be hits (`.company/work/P20261116.000003/01-feature/04-prototype-backend-engineer.md` `## Answer`). So every doubt is a miss, the Ship Gate never takes a reused Handoff, and cold wins (ADR `docs/adr/0076-cold-wins.md`).

## Key (columns)
| column | value |
|---|---|
| `v` | `1`; a new version makes every older row a miss (`reason: version`) |
| `step` | `<role>` plus the plan ticket ID when the dispatch has `Task:`, else `<role>` alone (the row `id`) |
| `dispatch` | SHA-256 of the dispatch prompt (from `--dispatch`), LF line ends, trailing spaces trimmed, lines starting `Round:` or `Output:` removed. Any other prompt change (Goal, Input Handoffs, Files, Risk tier, Role skills) misses. |
| `model` | the model id the Lead dispatches with (`--model`) |
| `inputs` | SHA-256 over sorted lines `<path>\0<git blob id>` of every declared input (below). Each file is hashed by content with `git hash-object` (tracked or not, so untracked `.company/` inputs count); a folder is all its files. A missing input gives the line `<path>\0missing`. |
| `node` | `process.version` |
| `os` | `<process.platform>-<process.arch>` |
| `lock` | SHA-256 over sorted `<path>\0<blob id>` of the tracked lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `Cargo.lock`, `go.sum`, `poetry.lock`, `uv.lock`, `Gemfile.lock`, `composer.lock`, `packages.lock.json`), or `none` |
| `check` | SHA-256 of the active plugin's `scripts/check.mjs` |
| `env` | sorted `[name, hmac]` pairs for every set env var named `AICO_*` (except `AICO_COLD`), `NODE_OPTIONS`, `NODE_ENV`, `CLAUDE_PLUGIN_ROOT`; `hmac` = first 16 hex of HMAC-SHA256(run salt, value) |
`key` = SHA-256 of the canonical JSON of the columns (keys sorted). The run salt is 32 random bytes in `.company/work/<parts>/step-keys.salt`, created once (`wx`, mode 0600 where the OS supports it), never printed or logged. Env values, the salt and secrets never appear in a row; only names and HMACs.

## Declared inputs
From the `before` arguments, taken from the dispatch: every `--input` path (Input Handoffs, `Task brief:`, `Files:` paths), plus `.company/project.md`, `.company/standards.md` when present, and `agents/<role>.md` of the active plugin. `--files none` (or no `--files`) adds the whole tree: `git rev-parse HEAD^{tree}` plus the SHA-256 of `git status --porcelain=v1 -z`, so any change misses.
A Step is **uncacheable** (`result: uncacheable`, never hits, never becomes an entry) when: `--dispatch` or `--model` is missing; `before` gets `--undeclared <dispatch key>` (a dispatch line holding a path the key does not know); or its Handoff's `files-touched` names a path outside its `--files` (found by `after`, which then marks the row uncacheable).

## Entries and hits
An **entry** is an `outcome` row written by `after` for a dispatched Step (not reused, not cold, not uncacheable) whose Handoff has `status: done` and Blocking `none` (no tagged item). It stores `key`, `handoff` (repo-relative path) and `hsha` (SHA-256 of that file).
`before` gives `hit` only when all hold, else `miss` with the first failing reason:
1. not cold and no `--verify` (`cold`, `verify`); `--round` is 1 or more (`round0`);
2. not uncacheable;
3. the newest earlier entry of the same `id` has the same `key` (`first`, or the first differing column name in table order) and is not purged (`purged`);
4. its Handoff file exists and still has hash `hsha` (`handoff-changed`);
5. the log and salt read cleanly and are within limits (`error:<git|read|log|salt|limit|parse>`).
An error is a `miss` with exit 0, never a hit and never a stop: the Lead dispatches as usual. Entries live in one run folder only; nothing is reused across runs.

## Reuse
On `hit`, the Lead runs `reuse` instead of dispatching. It rechecks hit conditions 4 and 5, then writes the Output path (`wx`, refused if it exists) as a copy of the entry's Handoff with frontmatter `step:` and `round:` set to the new Step, and `- Reused <source path> (stepKey <first 16 hex of key>); no Step ran.` as the first `## Did` bullet. It appends a `reused` row. Any refusal writes nothing; the Lead then dispatches as usual. A reused Step has no Agent call and creates no entry.

## Verify, cold wins and purge
The Ship Gate runs cold: every Step whose Handoff is a Ship Gate input is dispatched with `before --verify` (it computes the key and never hits), and the full suite runs with `AICO_COLD=1`. After a verify Step, `after` looks for a live entry or `reused` row with the same `id` and `key`: equal outcome → `agree`; different → `disagree` holding both outcomes, then `purge` of that key. Cold wins: the purged key never hits again in the run. The same compare runs after any dispatched Step whose key matches a live entry (for example after a `reuse` refusal). The step-keys log is the run's stepKey ledger; both results are logged there.

## Cold (rollback)
`AICO_COLD` set to any value except empty, `0` or `false`, or `--cold` on a command: nothing is read from the log, no key is computed, no entry is written and nothing is purged; `before` and `after` each write one `cold` row (no `key`, no `cols`) and `reuse` is refused (`refused: cold`). Setting `AICO_COLD=1` alone is the rollback: reuse stops at once. Tags and the nightly run set it in CI; `scripts/check.mjs --cold` sets it for its process.

## Log
`.company/work/<parts>/step-keys.jsonl`, append-only, LF, a line at most 1024 bytes, a file at most 256 KiB, opened with `lstat` (a link is refused). One row per event:
`{"v":1,"at":"<ISO time>","step":"<NN-role>","id":"<step column>","round":<n>,"key":"<64 hex>","cols":{...columns but env as names and hmacs...},"result":"miss|hit|uncacheable|cold|verify|reused|outcome|agree|disagree|purge","reason":"<at most 120 characters>"}`
`outcome` rows add `handoff`, `hsha` and `outcome` (`status`, sorted Blocking tags, sorted `files-touched`); `disagree` rows add `cached` and `cold` outcomes.

## CLI (`node scripts/step-key.mjs <cmd>`; refusals `refused: <reason>` on stdout, exit 2; nothing written on a refusal)
| Command | Does |
|---|---|
| `before <slug> <NN-role> --round <n> --dispatch <path>\|- --model <id> [--task <ticket>] [--input <path>]... [--files <path>,...\|none] [--undeclared <key>]... [--verify] [--cold]` | Computes the key, appends one row, prints `hit <source NN-role>`, `miss <reason>`, `uncacheable <reason>`, `verify` or `cold`. `-` reads the prompt from stdin. |
| `reuse <slug> <NN-role> --output <path> [--cold]` | Copies the hit's Handoff as above; prints `reused <source path>`. Refused unless the newest `before` row of `<NN-role>` is `hit`. |
| `after <slug> <NN-role> [--cold]` | Reads the Step's Handoff, appends `outcome` and any `agree`, `disagree`, `purge`; prints `agree`, `disagree`, `none` or `cold`. After a `reused` row it writes nothing and prints `none`. |
| `stats <slug>` | Prints counts per `result` (`reused` = Steps saved), writes nothing. |
Exports: `columns(opts)` (pure given injected readers) and `compare(a, b)` (first differing column or `null`). Every path argument is repo-relative; `..`, absolute paths and control characters are refused.

## Fixtures
`tests/contracts/step-key/key-table.json` holds the key table: each row is a column set, a one-column change and the expected `hit` or `miss <column>`. CI replays it under `npm test`, so a broken key fails the PR.

## Compatibility
v1.0 (unshipped; revised in place at the Plan Gate to enable reuse). A new column, a new env name or a stricter hit condition can only add misses: minor bump. Anything that can add hits (a removed column, a looser hit condition, reuse of Ship Gate inputs, a weaker cold switch) is a major bump and needs the CEO.
