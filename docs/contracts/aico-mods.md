# Contract: aico-mods v1

Provider: the aico plugin's hooks module (`hooks/hooks.json` → `./register.tsx`, which imports the four mods from `mods/`). Consumers: the CEO (views, the commit question), `/aico:settings` (switches). API: the Claude Code function-hooks API of the installed build (`plugin-authoring`); `claude plugin validate` is the authority on what it accepts.
Rationale: `docs/adr/0015-mods-thin-hooks-over-scripts.md`, `0016-run-state-record.md`, `0017-blast-radius-fail-closed.md`.
Revised after the spikes (CEO, Fix round 6; still unshipped, no version change): SP-M1 `60-spike-frontend-engineer.md` (surfaces, widths, spawn cost), SP-M2 `61-spike-backend-engineer.md` (commit gate), SP-M3 `62-spike-ai-data-engineer.md` (cache lifetimes). Keep-warm is cut; Cache Tax shows when the Lead's 1-hour cache expires instead.

## Shape
- One hooks module for the plugin; one file per mod: `mods/savvy.tsx`, `mods/cache-tax.tsx`, `mods/reflect.tsx`, `mods/blast-radius.ts`; shared code in `mods/shared/*.ts`; pure logic (parsers, formatters, the status composer, the git-commit detector, the cache clock, JSON guards) in `mods/lib/*.mjs` with no `$`, no Node import and no npm package, so `npm test` covers it.
- `types/index.d.ts` declares `interface PluginState { aico: … }`; `plugin.json` names it under `"types"`. State keys (all `Shaped<…>`, shape tag `v1`): `settings`, `run`, `agents` (a family keyed by `agentId`), `cost`, `cacheClock`, `reflect`, `blast`.
- No `import()`, no module-level state the views draw from (a reload loses it), no `$.fs.write`, no network.
- Validator rules (SP-M1, Claude Code 2.1.310): `$` is passed only to functions declared at the top level of a module file (or imported from the mod's own files), never to a closure declared inside `register`; keep `register` thin. `$.ui.invalidate('ui.render')` takes the event name and is called directly, never bound or optional-chained. `$.plugin.root` is a string property; `$.session.root()` is a call.
- Surfaces: views draw on `terminal` and `desktop`; on `vscode` and `mobile` every `ui.render` hook returns `next(e)`. The Blast Radius gate is not a view and acts on every surface.
- **Proof per surface (SP-M1).** `terminal` is proven on Windows (pane, status line, toast, `$.process.run`, `$.session.root()`, `$.plugin.root`, `fs.stat` tick; also under `claude -p`, where `ui.open` answers `isPlaced: false`). `desktop` is **unverified**: no desktop app on the test machine, only `claude plugin test` mounts with `surface: 'desktop'`, and the API documents `$.process` as CLI only. So every script-sourced field must degrade: where `$.process` is missing or `process.run` rejects, the field shows `unknown` and the view still draws. On such a surface Blast Radius counts the failed `review-depth` call as a security hit and asks (or denies with no approver).

## Sources (allow-list; a mod reads nothing else)
| Source | Read through | Used by |
|---|---|---|
| Resolved settings (`aico-settings` v1.1 `mods`, `roles.<role>.name`) | `settings.mjs get` | all |
| Run view (`run-state` v1) | `run-state.mjs active --json` | Savvy, Reflect, Blast Radius (tier), Cache Tax (active run) |
| Ledger (`token-ledger` v1) | `ledger.mjs report <run> --json --live` | Cache Tax, Reflect retrospective |
| Handoffs of the active run | `reflect.mjs` (below), `run-state.mjs` | Reflect, Savvy |
| Touched paths, tier, depth (`review-depth` v1) | `review-depth.mjs … --json` | Blast Radius |
| Lessons (`lessons` v1) | `lessons.mjs accept` (write only) | Reflect |
| Running subagents | the `agent.spawn` hook's `prompt` (only the `Output:`, `Name:`, `Base commit:`, `Risk tier:` lines, matched by the regexes below, from the first 64 KiB) and `$.agent.list()` | Savvy, Blast Radius |
| Main-loop request times (and the cache-lifetime split of their usage, when the event carries it) | `turn.start`, `turn.step`, `turn.complete` hooks (main loop only: no `agentId`) | Cache Tax (cache clock) |
`project.md` and `docs/contracts/` are read only inside `review-depth.mjs`. File-change detection uses `$.fs.stat` on the run folder, its `run-state.jsonl` and `.company/ledger/<run>.jsonl` (no reads).

Prompt line regexes: `^Output: \.company/work/([a-z0-9][a-z0-9-]{0,63})/(\d{2})-([a-z][a-z0-9-]{0,40})\.md$`, `^Name: ([^\r\n]{1,40})$`, `^Base commit: ([0-9a-f]{7,40})$`, `^Risk tier: (low|medium|high)$`. No match → the field is `unknown`.

## Calling a script
- `$.process.run(['node', <$.plugin.root>/scripts/<name>.mjs, …args], { cwd: <$.session.root()>, timeoutMs })`: no shell. `timeoutMs`: 1000 for `settings.mjs get` and `run-state.mjs`; 5000 for `ledger.mjs report`, `reflect.mjs step`, `lessons.mjs accept` and the pre-review `review-depth`; 10000 for the commit gate's `review-depth` and `reflect.mjs retro`.
- Spawn cost (SP-M1, Windows terminal): p50 about 31–41 ms, p95 40 ms idle and up to about 300 ms in the first seconds of a session. So **no `session.start` hook awaits a script**: it returns `next(e)`, and each field fills when its call settles (until then `unknown`). The only hooks that await a script are Blast Radius's `tool.check` (commit gate) and its pre-review `agent.spawn` (5 s cap).
- Availability: the script caller (`mods/shared/run-script.ts`) checks once per session that `$.process.run` exists, in a form `claude plugin validate` accepts; missing → every script-sourced field `unknown` for the session, no retry loop.
- Exit code ≠ 0, timeout, rejection, stdout over 256 KiB, invalid JSON or a JSON value that fails the mod's allow-list guard (`mods/lib/guard.mjs`: known keys, types, ranges) → that field shows `unknown`. Never a guessed value, never a thrown hook, never a session error (AC38). Stdout is trimmed of a trailing CR/LF before parsing (Windows prints CRLF).
- Untrusted text (Handoff lines, Role names, paths) is drawn with `Text` only, never `Markdown` or `Link`; control characters are replaced and each value is cut to its stated length.

## Refresh
- Settings: `get` at `session.start` and at every main-loop `turn.start`; a change takes effect by the next turn (AC36).
- Active run: `run-state.mjs active --json` at `session.start`, then a `$.clock.every(2000)` tick that `stat`s the sources and calls a script only when an mtime or size changed; while no run is active the tick checks `.company/work/` every 10 s at most (one `fs.list`, at most 200 entries). Views update within 5 s of a Step start (`agent.spawn`) or a Handoff write (AC40).
- The cache clock recomputes on the same tick from the stored request time; it calls no script.
- Timers start only for mods that are on; a mod switched off cancels its timers.

## Status line and panes
- One status line for the plugin (`$.ui.status`), composed by `mods/lib/status.mjs`: `aico · <savvy> · <cost> · <blast> · <reflect>`, each part only when its mod is on and has something to say; one line, at most 160 characters, parts dropped from the right (reflect, cost, blast) before Savvy is cut. Nothing to say → `$.ui.status(undefined)`. The host adds the plugin-name prefix and a glyph (SP-M1); the 160 characters are the mod's own text.
- Every state is text: `[tax]` marks cache writes, `running`, `unknown`, `warn`, `asked`, `refused`, `expired`; colour is never the only carrier and no colour is used when `NO_COLOR` is set (AC39).
- Panes: `aico-run` (Savvy), `aico-cost` (Cache Tax), `aico-reflect` (Reflect). Commands registered at `session.start`: `aico-run`, `aico-cost`, `aico-reflect` (each opens its pane; `{ text }` answer only when the mod is off: `<mod> is off; switch it on in /aico:settings`).
- **Width (SP-M1, 2.1.310).** A pane lays out to `e.props.bodyColumns`, never `e.viewport.columns` (docked, `viewport.columns` is the transcript side). Docked panes measured 39 (110 terminal columns) to 89 cells (200 columns); an asked pane below 110 columns draws `inline` (86 cells at 90 columns). Each view has a layout for 39 cells: values cut with `…`, no row wider than `bodyColumns`.
- **Unasked open.** `pane: auto` calls `$.ui.open` unasked only when a run becomes active; it docks only at 110 terminal columns or more (`isPlaced: false` below, and under `claude -p`). Then the full one-line summary stays on the status line (AC35). An asked open (the command) works at any width. The `plugin-authoring` skill's "144 columns" does not hold in 2.1.310.

## M1 Savvy
- Active run (`run-state` v1) only; none → no pane content, no status part, no timer beyond discovery (AC41).
- Shows: task slug, wave, current Step and Role with Name, Gates passed (`brief, plan`), Fix round, elapsed run time; one line per running subagent: Step, Role (Name), elapsed. Current Step = the highest Step of a running subagent, else the newest Step file. After `end`: the final state with outcome and total time, until the next run starts or the session ends.
- Status part: `run <slug> w<wave> S<step> r<round> <elapsed>`; each `unknown` field prints `?`.

## M2 Cache Tax
- One row per `report --json --live` row: Role (Name), Step, in, cache write `[tax]`, out, cache read, spend; numbers are exact integers equal to the JSON (AC42). A subagent seen in `agent.spawn` with no ledger row yet shows `running` in every count cell; `unreconciled` rows show `unknown`.
- Totals: spend, cache read, cache write and `cache write = <p>% of spend [tax]`. Status part: `spend <n> tax <p>%`, plus the cache clock below.
- **Cache clock (AC43 as re-scoped by the CEO; replaces keep-warm).** Shows when the main session's (the Lead's) cached prefix expires.
  - Lifetimes (SP-M3, 2.1.310): the main loop writes the 1-hour lifetime (1216 of 1217 main-loop requests), subagents write 5 minutes (2705 of 2705). Main-loop reuse held up to 60 min and broke after (62–70 min: floor only).
  - Expiry = time of the last main-loop request (newest `turn.step` without `agentId`, else `turn.start`) + its lifetime. Every main-loop request restarts it. Lifetime per request: from the event's usage split (`cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens`) when the installed API types carry it; otherwise the constant 60 min in `mods/lib/cache-clock.mjs`, labelled `1 h (measured)`. The M9 builder checks the types and implements exactly one of the two, named in its Handoff.
  - Pane line: `Lead cache: expires <HH:MM> (in <m> min)`, `Lead cache: expired <HH:MM>; the next turn rewrites it`, or `Lead cache: unknown` (no main-loop request seen in this session yet, e.g. a mod loaded mid-session). Under it, always: `Subagent caches last 5 minutes; nothing keeps them warm.`
  - Status part, while a run is active: ` cache <m>m`, ` cache expired` or ` cache ?`.
  - It never forks, pings or calls a model: SP-M3 found no evidence that a fork keeps the entry alive (a fork 55 min in did not read the main tail; the main loop's next request at 66 min read only the floor).

## M3 Reflect
- Step check (`step_check`): for each new or changed Step file of the active run (once per mtime and size), `reflect.mjs step <slug> <file> --json` → at most 5 lines: did, went wrong (Blocking items by tag, lint errors, re-dispatch, handover), remember, 0–3 suggested Lessons. Drawn with `$.ui.log` (a transcript notice the model never reads) and in the `aico-reflect` pane.
- Retrospective (`retrospective`): at the run's `end`, `reflect.mjs retro <slug> --json` → top 3 spend and top 3 time rows (from `report --json --live`, equal to the ledger), Fix-round causes counted per blocking tag, suggested Lessons.
- `mode: model` (user level only): after the deterministic result, one `$.model.complete` on the session's model with a fixed instruction block first (`cache: true`) and at most 16 KiB of that Handoff; its text replaces `remember` and the suggestions; its `usage` goes to `ledger.mjs add-mod <run> reflect <step|RT> …`. Aborted after 60 s; failure keeps the deterministic result.
- Every suggestion is labelled `suggested` and has its own `Accept` and `Decline` buttons in the pane; `Accept` runs `lessons.mjs accept --role <role> --text <text>` for that one Lesson. Pending suggestions live in session state only; decline, no answer or session end writes nothing (AC44).
- Reflect runs from timers and observers only: no hook awaits it, it never edits a Handoff, never blocks a Step and never delays a dispatch (AC46).

## M4 Blast Radius
- **Commit gate** on `tool.check` for the shell tools **`Bash` and `PowerShell`** (filter on `e.tool`; SP-M2: on Windows without Git Bash the engine's shell tool is `PowerShell`, and a `Bash`-only matcher never fires):
  1. `mods/lib/git-commit.mjs` `commitIntent(command, shell)` (total, never throws; `shell` is `bash` or `powershell`) → `{ isCommit, scope, repo }`. It splits on `;`, `&&`, `||`, `|` and newlines (PowerShell also: a backtick line continuation joins lines; `&&`/`||` exist only in PowerShell 7), skips `VAR=x` prefixes (bash) and `$env:X=…;` statements (PowerShell), strips the call operator `&` and quotes around the program, accepts `git` and `git.exe`, skips git's global options (`-C <dir>`, `-c <k=v>`, `--git-dir=…`, `--work-tree=…`, `--no-pager`, …) and finds the `commit` subcommand. `-a`, `--all`, `-i`, `--include`, `-o`, `--only` or a pathspec → `scope: worktree`, else `staged`. Fallback: any command holding the words `git` and `commit` that the parser cannot place is a commit with `scope: worktree` (fails toward asking). Not a commit → `next(e)` unchanged.
  2. `review-depth.mjs --staged|--worktree --json [--risk <run tier>] [--repo <dir>]`. Hits = paths whose categories include `core`, `contract` or `security`. Script failure or no `$.process` → one hit `unknown` in category `security`.
  3. `verdict = await next(e)`. `deny` → returned as is. Any hit in a category set to `ask`: `e.approver` is `person` or `host` → `{ decision: 'ask', reason }` (one question listing every hit); `approver` absent (`claude -p`, a background loop) → `{ decision: 'deny', reason }` with `nobody can be asked; commit refused` (AC48). The engine would turn an `ask` with no approver into a deny anyway (SP-M2); the mod answers `deny` itself so the reason is the clear one. Only `warn` hits → the verdict unchanged, a toast and the status part `blast warn <category> <n>` for 60 s.
  4. The hook never answers `allow` and never changes permission settings. Its `.catch` answers `{ decision: 'deny', reason: 'Blast Radius failed; commit refused' }` for a commit and `next(e)` otherwise.
  - Defaults (CEO): `core: ask`, `security: ask`, `contract: warn` (`aico-settings` v1.1).
  - `reason`: `Blast Radius: Core: <paths>; Contract: <paths>; Security: <paths> (+<n> more). Tier <tier>, review depth <depth>. Modules: <names>.`, at most 600 characters; with `e.agentId` set it starts `From subagent <Step> <role>: `. The full list goes to `$.ui.log` first. The reason reaches the model (deny) and the person's dialog (ask); a host prompt tool (`--permission-prompt-tool`) receives only `tool_name`, `input` and `tool_use_id`, so a host-driven run sees no reason (SP-M2).
  - Mode coverage (SP-M2, headless, 2.1.310): a plugin `ask` is honoured under `default`, `acceptEdits`, `bypassPermissions`, `auto`, `plan` and `dontAsk`, and over a matching allow rule. No `tool.call` + `$.ui.ask` fallback is built.
  - Unverified (needs a person; types say yes): the dialog shows the long reason in terminal and desktop; `e.approver` is `person` there; "don't ask again" saves no rule that settles a later plugin `ask`. QA runs the manual check in `61-spike-backend-engineer.md` `## Next` on the terminal before Ship; desktop stays unverified.
- **Before a code-review dispatch** (`agent.spawn`, `subagentType` `^(aico:)?code-reviewer$`): `review-depth.mjs <Base commit> --json --risk <Risk tier>` (5 s cap), then `$.ui.log` of files, Modules, Contracts, Core items, tier and depth, a toast and the status part; then `next(e)` unchanged. Never blocks the dispatch.
- Tier and depth shown are exactly the `review-depth` JSON's (AC47 drift test).

## Tokens (AC37)
No mod adds a system-prompt section, a context block, a `$.session.append` row, a `$.prompt.submit` or a dispatch. The only model call is Reflect `model` mode (off by default, user level only), ledgered. The one text a mod puts before the model is a Blast Radius refusal or ask reason (≤ 600 characters), which AC48 requires.

## Off
A mod that is off registers its hooks but each returns `next(e)` at once, draws nothing, sets no status part, runs no timer and calls no script; its options stay in settings (AC36).

## Tests
- `claude plugin test`: per mod, one case per surface (`terminal`, `desktop`) for the view, plus: off draws nothing; bad JSON, timeout, over-size script output and a missing `$.process` show `unknown`; the view at `bodyColumns` 39 has no row wider than 39; Blast Radius `ask` with `approver: 'person'`, `deny` with no approver, `warn` toast, never `allow`, `.catch` denies a commit, both `Bash` and `PowerShell` events gated. The `desktop` case is mocked; it proves layout, not the desktop host.
- `npm test` (`scripts/mods-lib.test.mjs`): every `mods/lib/*.mjs` function, hostile first (proj.M4): CRLF, control characters, 10 MiB strings, `__proto__` keys, the commit-detector cases, the cache clock (1 h and 5 min lifetimes, request at the boundary, clock before the request, no request → `unknown`), and the status composer's width rule.
- Commit-detector cases. Bash: `git -C x commit -m y`, `A=1 git commit`, `echo commit && git commit`, `bash -c "git commit"`, `git log --grep commit` (not a commit), `gitcommit` (not a commit). PowerShell: `cd x; git commit -m y`, `git add .; git commit -am y` (worktree), `& git commit -m y`, `& "git.exe" commit`, `git commit ` + backtick + newline + `-m y`, `$env:GIT_X=1; git commit`, `git status && git commit` (PowerShell 7), `Write-Output commit` (not a commit), `git log --grep commit` (not a commit).
