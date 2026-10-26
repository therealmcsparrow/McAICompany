# Contract: aico-mods v1

Provider: the aico plugin's hooks module (`hooks/hooks.json` → `./register.tsx`, which imports the four mods from `mods/`). Consumers: the CEO (views, the commit question), `/aico:settings` (switches). API: the Claude Code function-hooks API of the installed build (`plugin-authoring`); `claude plugin validate` is the authority on what it accepts.
Rationale: `docs/adr/0015-mods-thin-hooks-over-scripts.md`, `0016-run-state-record.md`, `0017-blast-radius-fail-closed.md`.

## Shape
- One hooks module for the plugin; one file per mod: `mods/savvy.tsx`, `mods/cache-tax.tsx`, `mods/reflect.tsx`, `mods/blast-radius.ts`; shared code in `mods/shared/*.ts`; pure logic (parsers, formatters, the status composer, the git-commit detector, JSON guards) in `mods/lib/*.mjs` with no `$`, no Node import and no npm package, so `npm test` covers it.
- `types/index.d.ts` declares `interface PluginState { aico: … }`; `plugin.json` names it under `"types"`. State keys (all `Shaped<…>`, shape tag `v1`): `settings`, `run`, `agents` (a family keyed by `agentId`), `cost`, `reflect`, `blast`, `keepWarm`.
- No `import()`, no module-level state the views draw from (a reload loses it), no `$.fs.write`, no network.
- Surfaces: views draw on `terminal` and `desktop`; on `vscode` and `mobile` every `ui.render` hook returns `next(e)`. The Blast Radius gate is not a view and acts on every surface.

## Sources (allow-list; a mod reads nothing else)
| Source | Read through | Used by |
|---|---|---|
| Resolved settings (`aico-settings` v1.1 `mods`, `roles.<role>.name`) | `settings.mjs get` | all |
| Run view (`run-state` v1) | `run-state.mjs active --json` | Savvy, Reflect, Blast Radius (tier), keep-warm |
| Ledger (`token-ledger` v1) | `ledger.mjs report <run> --json --live` | Cache Tax, Reflect retrospective |
| Handoffs of the active run | `reflect.mjs` (below), `run-state.mjs` | Reflect, Savvy |
| Touched paths, tier, depth (`review-depth` v1) | `review-depth.mjs … --json` | Blast Radius |
| Lessons (`lessons` v1) | `lessons.mjs accept` (write only) | Reflect |
| Running subagents | the `agent.spawn` hook's `prompt` (only the `Output:`, `Name:`, `Base commit:`, `Risk tier:` lines, matched by the regexes below, from the first 64 KiB) and `$.agent.list()` | Savvy, Blast Radius |
| Main-loop request times and usage | `turn.start`, `turn.step`, `turn.complete` hooks (main loop only: no `agentId`) | keep-warm |
| Prices | `mods/prices.json` (shipped with the plugin) | Cache Tax |
`project.md` and `docs/contracts/` are read only inside `review-depth.mjs`. File-change detection uses `$.fs.stat` on the run folder, its `run-state.jsonl` and `.company/ledger/<run>.jsonl` (no reads).

Prompt line regexes: `^Output: \.company/work/([a-z0-9][a-z0-9-]{0,63})/(\d{2})-([a-z][a-z0-9-]{0,40})\.md$`, `^Name: ([^\r\n]{1,40})$`, `^Base commit: ([0-9a-f]{7,40})$`, `^Risk tier: (low|medium|high)$`. No match → the field is `unknown`.

## Calling a script
- `$.process.run(['node', <plugin root>/scripts/<name>.mjs, …args], { cwd: <session root>, timeoutMs })`: no shell; `timeoutMs` 5000 (10000 for `review-depth` and `reflect retro`).
- Exit code ≠ 0, timeout, rejection, stdout over 256 KiB, invalid JSON or a JSON value that fails the mod's allow-list guard (`mods/lib/guard.mjs`: known keys, types, ranges) → that field shows `unknown`. Never a guessed value, never a thrown hook, never a session error (AC38).
- Untrusted text (Handoff lines, Role names, paths) is drawn with `Text` only, never `Markdown` or `Link`; control characters are replaced and each value is cut to its stated length.

## Refresh
- Settings: `get` at `session.start` and at every main-loop `turn.start`; a change takes effect by the next turn (AC36).
- Active run: `run-state.mjs active --json` at `session.start`, then a `$.clock.every(2000)` tick that `stat`s the sources and calls a script only when an mtime or size changed; while no run is active the tick checks `.company/work/` every 10 s at most (one `fs.list`, at most 200 entries). Views update within 5 s of a Step start (`agent.spawn`) or a Handoff write (AC40).
- Timers start only for mods that are on; a mod switched off cancels its timers.

## Status line and panes
- One status line for the plugin (`$.ui.status`), composed by `mods/lib/status.mjs`: `aico · <savvy> · <cost> · <blast> · <reflect>`, each part only when its mod is on and has something to say; one line, at most 160 characters, parts dropped from the right (reflect, cost, blast) before Savvy is cut. Nothing to say → `$.ui.status(undefined)`.
- Every state is text: `[tax]` marks cache writes, `running`, `unknown`, `warn`, `asked`, `refused`; colour is never the only carrier and no colour is used when `NO_COLOR` is set (AC39).
- Panes: `aico-run` (Savvy), `aico-cost` (Cache Tax), `aico-reflect` (Reflect). `pane: auto` opens the pane unasked only when the surface docks it (`e.viewport.isFullscreen`); `$.ui.open` answering `isPlaced: false` (below the seat width) keeps the full one-line summary on the status line (AC35). Commands registered at `session.start`: `aico-run`, `aico-cost`, `aico-reflect` (each opens its pane; `{ text }` answer only when the mod is off: `<mod> is off; switch it on in /aico:settings`).

## M1 Savvy
- Active run (`run-state` v1) only; none → no pane content, no status part, no timer beyond discovery (AC41).
- Shows: task slug, wave, current Step and Role with Name, Gates passed (`brief, plan`), Fix round, elapsed run time; one line per running subagent: Step, Role (Name), elapsed. Current Step = the highest Step of a running subagent, else the newest Step file. After `end`: the final state with outcome and total time, until the next run starts or the session ends.
- Status part: `run <slug> w<wave> S<step> r<round> <elapsed>`; each `unknown` field prints `?`.

## M2 Cache Tax
- One row per `report --json --live` row: Role (Name), Step, in, cache write `[tax]`, out, cache read, spend; numbers are exact integers equal to the JSON (AC42). A subagent seen in `agent.spawn` with no ledger row yet shows `running` in every count cell; `unreconciled` rows show `unknown`.
- Totals: spend, cache read, cache write and `cache write = <p>% of spend [tax]`. Status part: `spend <n> tax <p>%`.
- **Keep-warm** (off by default, user level only):
  - What it keeps warm: only the main session's (the Lead's) cached prefix, by `$.model.fork({ prompt: 'Reply OK.' })`; subagent prefixes cannot be kept warm by a mod.
  - Runs only while the mod and `keep_warm` are on, a run is active, and the last main-loop request started at least `interval` ago. `interval` = the entry lifetime the main loop writes (measured by Spike SP-M3: 1 h, else 5 min) minus 5 min (1 h) or 1 min (5 min).
  - Stops at the horizon (`keep_warm_horizon_min` after the main loop's last request), at run end, at `session.end`, and when switched off; the next main-loop request starts a new horizon.
  - Every fork's `usage` is written with `ledger.mjs add-mod <run> keepwarm next <in> <cache_write> <cache_read> <out> <model> <ms>` (AC37); a failed write shows `ledger write failed` and stops keep-warm.
  - Cost view, before switching on and while on (AC43): per hour of waiting, cost = pings × (prefix × cache-read price + in × input price + out × output price) and saving = one cache write of the prefix avoided (prefix × write price for the measured lifetime); in tokens and list-price USD from `mods/prices.json` with its date; prefix size from the last main-loop request's usage. Cost ≥ saving → the sentence `Keep-warm costs more than it saves at this size.` It always shows: `1 hour is the longest cache lifetime the API offers (5 minutes by default); each cache read restarts it.` Unknown model price → USD `unknown`, tokens still shown.

## M3 Reflect
- Step check (`step_check`): for each new or changed Step file of the active run (once per mtime and size), `reflect.mjs step <slug> <file> --json` → at most 5 lines: did, went wrong (Blocking items by tag, lint errors, re-dispatch, handover), remember, 0–3 suggested Lessons. Drawn with `$.ui.log` (a transcript notice the model never reads) and in the `aico-reflect` pane.
- Retrospective (`retrospective`): at the run's `end`, `reflect.mjs retro <slug> --json` → top 3 spend and top 3 time rows (from `report --json --live`, equal to the ledger), Fix-round causes counted per blocking tag, suggested Lessons.
- `mode: model` (user level only): after the deterministic result, one `$.model.complete` on the session's model with a fixed instruction block first (`cache: true`) and at most 16 KiB of that Handoff; its text replaces `remember` and the suggestions; its `usage` goes to `ledger.mjs add-mod <run> reflect <step|RT> …`. Aborted after 60 s; failure keeps the deterministic result.
- Every suggestion is labelled `suggested` and has its own `Accept` and `Decline` buttons in the pane; `Accept` runs `lessons.mjs accept --role <role> --text <text>` for that one Lesson. Pending suggestions live in session state only; decline, no answer or session end writes nothing (AC44).
- Reflect runs from timers and observers only: no hook awaits it, it never edits a Handoff, never blocks a Step and never delays a dispatch (AC46).

## M4 Blast Radius
- **Commit gate** on `tool.check` for `Bash`:
  1. `mods/lib/git-commit.mjs` `commitIntent(command)` (total, never throws) → `{ isCommit, scope, repo }`. It splits on `;`, `&&`, `||`, `|` and newlines, skips `VAR=x` prefixes and git's global options (`-C <dir>`, `-c <k=v>`, `--git-dir=…`, `--work-tree=…`, `--no-pager`, …) and finds the `commit` subcommand. `-a`, `--all`, `-i`, `--include`, `-o`, `--only` or a pathspec → `scope: worktree`, else `staged`. Fallback: any command holding the words `git` and `commit` that the parser cannot place is a commit with `scope: worktree` (fails toward asking). Not a commit → `next(e)` unchanged.
  2. `review-depth.mjs --staged|--worktree --json [--risk <run tier>] [--repo <dir>]`. Hits = paths whose categories include `core`, `contract` or `security`. Script failure → one hit `unknown` in category `security`.
  3. `verdict = await next(e)`. `deny` → returned as is. Any hit in a category set to `ask`: `e.approver` is `person` or `host` → `{ decision: 'ask', reason }` (one question listing every hit); `approver` absent (`claude -p`, a background loop) → `{ decision: 'deny', reason }` with `nobody can be asked; commit refused` (AC48). Only `warn` hits → the verdict unchanged, a toast and the status part `blast warn <category> <n>` for 60 s.
  4. The hook never answers `allow` and never changes permission settings. Its `.catch` answers `{ decision: 'deny', reason: 'Blast Radius failed; commit refused' }` for a commit and `next(e)` otherwise.
  - `reason`: `Blast Radius: Core: <paths>; Contract: <paths>; Security: <paths> (+<n> more). Tier <tier>, review depth <depth>. Modules: <names>.`, at most 600 characters; the full list goes to `$.ui.log` first.
- **Before a code-review dispatch** (`agent.spawn`, `subagentType` `^(aico:)?code-reviewer$`): `review-depth.mjs <Base commit> --json --risk <Risk tier>` (5 s cap), then `$.ui.log` of files, Modules, Contracts, Core items, tier and depth, a toast and the status part; then `next(e)` unchanged. Never blocks the dispatch.
- Tier and depth shown are exactly the `review-depth` JSON's (AC47 drift test).

## Tokens (AC37)
No mod adds a system-prompt section, a context block, a `$.session.append` row, a `$.prompt.submit` or a dispatch. Model calls are only keep-warm forks and Reflect `model` mode, each ledgered. The one text a mod puts before the model is a Blast Radius refusal or ask reason (≤ 600 characters), which AC48 requires.

## Off
A mod that is off registers its hooks but each returns `next(e)` at once, draws nothing, sets no status part, runs no timer and calls no script; its options stay in settings (AC36).

## Tests
- `claude plugin test`: per mod, one case per surface (`terminal`, `desktop`) for the view, plus: off draws nothing; bad JSON, timeout and over-size script output show `unknown`; Blast Radius `ask` with `approver: 'person'`, `deny` with no approver, `warn` toast, never `allow`, `.catch` denies a commit.
- `npm test` (`scripts/mods-lib.test.mjs`): every `mods/lib/*.mjs` function, hostile first (proj.M4): CRLF, control characters, 10 MiB strings, `__proto__` keys, the commit-detector cases (`git -C x commit -m y`, `A=1 git commit`, `echo commit && git commit`, `bash -c "git commit"`, `git log --grep commit` (not a commit), `gitcommit`), and the status composer's width rule.
