# Contract: lead-session-mcp v2.0

v2.0 (task P20261115.000001/01-fix, major, breaking): the tool no longer only points. From the frozen state it starts one helper, `scripts/lead-replace.mjs`, that waits for every background task and the end of the frozen turn, then types `/clear` and the hand-over prompt into the session's own terminal. Rationale: `docs/adr/0074-lead-replaced-in-place.md`, which supersedes the "starts nothing" clause of ADR 0056. New description, success text and refusals below; protocol and registration unchanged. Needs a security review (Compatibility). Amended before release after spike S1 (Windows 11, Claude Code 2.1.325): Claude Code gives each MCP server its own hidden console, so the Windows typer attaches to the claude process's console by pid before it types; v2.0 types on Windows only, macOS and Linux get `refused: unsupported terminal` (typing there is unproven). Amended again before release in fix round 1 (R-2, R-3): the arm is per session, so a second hand-over of the same run from a new session arms again and starts its own helper; and the turn-over wait counts only a Stop after the background tasks ended (idle seam), so the turn that called the tool no longer starts the typing early. Fix round 2 (R-18): the idle seam is the start of the last poll that still saw a live task, not the moment seam 1 returns done, so the detection delay no longer hides the notice turn's Stop.

v1.2 (task P20261109.000009-T13, additive): `lead_new_session` accepts a v3 run slug `<ProjectID>/<NN>-<playbook>` (checked with `isRunSlug`, its folder through `workParts`) and returns the `lead-handoff` v2.1 command naming it. Result and refusal texts for v2, v1.1 and legacy names are byte-identical to v1.1. Uses `lead-handoff` v2.1.

New Contract (task 2026-11-02 18.32 - Context Cap Hand Over, T2). Provider: `scripts/lead-launch-mcp.mjs` (Node built-ins only, no MCP SDK), registered by `mcpServers` in `.claude-plugin/plugin.json` (v1.1; v1 used a plugin root `.mcp.json`). Consumer: the frozen Lead (`context-guard` v1 allows this one tool). Uses `lead-handoff` v1.8 (`findRun`, `newSessionCommand`, `readSmall`, and `main` for `read`) and `work-folder-name` v1.1 (`isWorkFolder`). Rationale: `docs/adr/0056-hard-handover-outside-agent.md`.

v2.0: the frozen Lead calls it and the new Lead starts in the same terminal by itself. **It starts exactly one process**, the helper below, never `claude`, never a shell with model text. The hand-over itself still never needs it: where typing is unsupported or fails, the freeze reason's command stands.

## Registration
`mcpServers` in `.claude-plugin/plugin.json`: `{"lead-session":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/scripts/lead-launch-mcp.mjs"]}}`. There is no root `.mcp.json`: this repo is the plugin source and also a product folder, so Claude Code would read a root file a second time as project scope, where `CLAUDE_PLUGIN_ROOT` is unset, the path does not resolve, node exits 1 and the client shows `lead-session (CONNECTION_CLOSED)`. A root `.mcp.json` must not come back (`tests/lead-launch-mcp/registration.test.mjs`).
The tool name in Claude Code is `mcp__plugin_aico_lead-session__lead_new_session` (pattern `mcp__plugin_<plugin>_<server>__<tool>`, spike T1 with a server name without a hyphen; T5 confirms this exact name once in a live run and records it in `tests/lead-handover/evidence.md`). Server cwd = session cwd (spike T1), so the run is found from the cwd. The plugin cannot pre-approve the tool: expect one permission prompt per the CEO's settings. A refused prompt loses nothing, the command is also in the `context-guard` routes.

## Protocol
MCP over stdio: one JSON-RPC 2.0 object per line, UTF-8, LF. A line over 64 KiB is dropped and answered with `-32700`, id null. Only protocol lines on stdout; stderr stays silent. End of stdin: exit 0.
- `initialize`: answers the client's `protocolVersion` when it is a `YYYY-MM-DD` string, else `2025-06-18`; `capabilities` `{"tools":{}}`; `serverInfo` `{"name":"lead-session","version":<plugin.json version>}`.
- `"notifications/initialized"` and any other notification (an object with no `id`, whatever else it holds): no answer.
- `ping`: empty result.
- `"tools/list"`: the one tool below.
- `"tools/call"`: below.
- Bad JSON: `-32700`, id null.
- `-32600`: valid JSON that is not an object, id null; an `id` that is neither a string nor a number (`null` included), id null; a `method` that is not a string, with the request's id.
- `-32601`: unknown method with a valid `id`, whatever its `params`.
- `-32602`: on `initialize`, `ping` or `"tools/list"`, `params` present and not an object; on `"tools/call"`, `params` not an object, an unknown tool name or any argument given.

Method names are written in quotes inside the code marks, so the drift check never reads them as file paths.

## Tool `lead_new_session`
No arguments: `inputSchema` `{"type":"object","properties":{},"additionalProperties":false}`. The slug comes from the active run, never from the model. Description: `Starts the new Lead in this terminal after a context hand-over: waits for background tasks and the end of this turn, then types /clear and the hand-over prompt.`

On each call, in this order, stopping at the first that applies; a refusal is `isError: true` with the one text line, never a JSON-RPC error, and starts nothing:
| Check | Text |
|---|---|
| No active run (`findRun`) | `refused: no run` |
| Name fails `isWorkFolder` | `refused: bad slug` |
| Run record broken or fails its file checks | `refused: broken record` |
| A `subs` entry of the run with `stop` null | `refused: step running` |
| Newest `handover` of the record is not trigger `context` | `refused: no context handover` |
| No typer for this OS: `typer(process.platform)` (`scripts/lib/lead-typer.mjs`) is null; v2.0 has a typer for `win32` only | `refused: unsupported terminal` |
| Own exception, or the helper fails to start | `refused: error` |

Then it arms once per session: exclusive-create `lead-replace.json` in the run folder, `{"v":1,"session":<session of that newest handover>,"armAt":<ISO>,"state":"waiting-background"}`. The file already there and naming the same session → file unchanged, no second helper, same success text. The file already there and naming another session, or unreadable (an earlier hand-over of the same run) → replaced whole by a temp file in the run folder and a rename, then a helper starts as below, same success text. Then it starts the helper: `process.execPath` with argv `[<plugin>/scripts/lead-replace.mjs, <slug>, <process.ppid>]`, cwd the product root, no shell, `stdio: 'ignore'`, `windowsHide: true`, not detached (the shape spike S1 proved: it outlives the call and `/clear` and ends with the claude process), `unref()`. The seam is `newSession(root, now, deps)` with `deps.start(argv)`, so tests pass a fake.

Success, one text content, three lines:
```
The new Lead starts in this terminal once every background task has ended and this turn is over.
If it has not started, run in the product folder:
<command>
```
`<command>` = `newSessionCommand(slug)`: `claude "aico lead hand-over: run lead-handover read '<name>' first, as set out in references/lead-resume.md of the skill aico:pipeline, then follow that file."`, the `lead-handoff` v1.8 new-session line inside double quotes. The name shape (`work-folder-name` v1.1) rules out quotes, `$`, backtick, `%`, `\` and control characters, so the line is one safe argument in cmd, PowerShell and POSIX shells when the CEO pastes it. The prompt the helper types is the text inside its double quotes.

## Helper `scripts/lead-replace.mjs <slug> <claudePid>`
Internal to this Contract. Argv checked first: `<slug>` passes `isRunSlug` or `isWorkFolder`, `<claudePid>` matches `^[1-9][0-9]*$`; else exit 2, no file written. Each wait writes its `state` to `lead-replace.json` (atomic rename); it ends at `typed` or `failed: <reason>`. Seams, each a function with injectable deps:
1. **Background tasks ended** `backgroundDone({ dir, session, claudePid, list, onLive })`. Launches come from the guard record: one `{"ev":"bg","session"}` row per allowed Lead-session `Bash`, `PowerShell`, `Agent` or `Task` call with `run_in_background` true (`hook-event` v1.2 reads the flag; the cap engine writes the row). No row → done. Otherwise poll `list(claudePid)` (`[{pid,image,created}]`; Windows `Get-CimInstance Win32_Process` by `ParentProcessId`) every 2 s. A candidate is a direct child of `claudePid` with a shell image (`bash`, `sh`, `pwsh`, `powershell`, `cmd`, with or without `.exe`) created at or after the `at` of the first `bg` row; it is live when the same pid is a candidate in two polls in a row (hooks, the status line and probes start short shell children too; S1 saw a background `PowerShell` task as a `cmd.exe` child for its whole run). Done after two polls in a row with no live task. Background `Agent`s are Steps: the `step running` check covers them. No time limit; `claudePid` gone → `failed: session gone`. Each poll reads `t = now()` just before its `list` call; when, after that poll's update, some pid of this poll's candidates is live, it calls `onLive(t)` (optional, default none). Return values unchanged.
2. **Turn over** `turnOver({ dir, session, armAt, idleAt })`: `lead-context.json` names `session` with `at` at or after `max(armAt, idleAt)` (the `Stop` hook `measure`), both cut to whole seconds as readings are. `idleAt` (epoch ms, optional, default 0) is the idle seam: the last `t` seam 1 passed to `onLive`, or 0 when it never called it (no `bg` row, or no task seen live). The last task was seen running at a moment at or after `idleAt`, so it ended after `idleAt`, and so did the turn its task-end notice starts: that Stop always counts, however late seam 1 reports done. A Stop from before `idleAt`, such as the turn that called the tool while tasks still ran, does not count. At most 10 min from the start of this wait, else `failed: turn`.
3. **Type** `typeInto(text, { platform, run })` → `typed | unsupported | failed`: first `/clear` + Enter, then wait until `lead-context.json` names another session (SessionStart `clear`, `start`), at most 15 s, else `failed: clear`; then the prompt + Enter. Windows (the only typer in v2.0): `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <plugin>/scripts/lib/console-type.ps1 --pid <claudePid>`, text on stdin (UTF-8, `\r` = Enter). The script reads stdin first, then `FreeConsole()`, `AttachConsole(<claudePid>)`, opens `CONIN$` and calls `WriteConsoleInputW` with a key-down and key-up record per character (virtual key 0, Enter = virtual key 13). Without the attach `CONIN$` is the MCP server's hidden console and the text goes nowhere (S1 run 1). Exit 0 typed, 1 attach failed (`failed: attach`), 2 open or write failed (`failed: type`). Other platforms: `typer` is null and the server refuses before arming, so the helper never runs there. Only these two texts are ever typed, both built from a validated slug.

## Limits (not enforceable)
- Tools are model-called: nothing forces the Lead to call it. A hook cannot call it. The `context-guard` routes hold without it.
- It types into the caller's own terminal only: the console of `claudePid`, the server's `process.ppid`, never a model-given pid. Keys the CEO types during the wait mix with the typed text; the helper types only after the turn is over.
- macOS and Linux: no automatic start in v2.0 (`TIOCSTI` from an MCP child is unproven, the child may lack claude's controlling terminal, Linux 6.2 and later turn it off by default). Adding a typer there is a minor version after a spike on such a host.
- Proven on Windows Terminal (ConPTY). Classic conhost and the `Bash` tool's background shells are checked by spike S2 before the helper ships.
- Background tasks other than shells (`Monitor`, a non-Step background agent) are not seen. A background task that never ends keeps the old session; the CEO can stop it.
- Idle seam, no notice: if the last background task ends after the frozen turn stopped and no notice starts a later turn, no Stop comes at or after `idleAt`; the helper waits the full 10 min, ends `failed: turn`, and the success text's command stands.
- Idle seam, residual race: the frozen turn's own Stop counts when it is at or after `idleAt`. That happens when the last task ends before that Stop, or less than one poll interval (2 s plus one process query) plus 1 s (whole-second readings) after it. If its notice then starts a new turn that is still running when seam 1 reports done (about 2 to 3 poll intervals after the end), the helper types into that turn. A frozen Lead's notice turn is one short reply or one refused call, so this needs a turn longer than the detection delay.
- One arm file per run folder: a new session's call replaces the arm of an earlier one. A helper of that earlier session still waiting (its claude process alive) is not stopped and keeps writing its own `state`; it only types into its own `claudePid`.
- It appears in every Role's tool list. A Role calling it is refused (`step running`) and nothing starts.
- The server starts with each session. If it fails to start, no hand-over step depends on it.

## Personal data and destinations
Holds nothing personal. Reads the run's record, `lead-context.json` and the pid, image and start time of the direct children of the claude process, all local; writes only `lead-replace.json`. Types the run name into the session's own terminal. No network, no recipient added.

## Error cases
Refusals above. Helper `failed: <reason>` (`session gone`, `turn`, `attach`, `clear`, `type`), server down or tool not approved: the CEO uses the command from the success text or the freeze reason.

## Compatibility
v2.0 (breaking): new description, success text and refusal `unsupported terminal` (all of macOS and Linux in v2.0), a process start, the run-folder file `lead-replace.json`. Same server, tool name, protocol and arguments. Consumers to update: the frozen Lead's routes (`context-guard` wording only), `tests/lead-launch-mcp/server.test.mjs`, `scripts/guard-cap.test.mjs`, `scripts/lead-launch-mcp-v3.test.mjs`, `tests/lead-launch-mcp/new-lead-regression.test.mjs`. Needs a security review before release. v1.1: the returned `<command>` text now names `references/lead-resume.md` (the `lead-handoff` v1.8 new-session line; v1 returned the v1.7 text naming `references/lead-handover.md`), and the registration moves from the root `.mcp.json` to `plugin.json` `mcpServers`; same server name, same tool name, same protocol, so no consumer changes. v1: new Contract. A new tool, an argument, a new refusal text or any process start needs a new version; starting a process is a major bump and needs a security review.
