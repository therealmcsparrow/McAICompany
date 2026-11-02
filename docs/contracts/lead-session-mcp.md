# Contract: lead-session-mcp v1

New Contract (task 2026-11-02 18.32 - Context Cap Hand Over, T2). Provider: `scripts/lead-session-mcp.mjs` (Node built-ins only, no MCP SDK), registered by the plugin root file `.mcp.json`. Consumer: the frozen Lead (`context-guard` v1 allows this one tool). Uses `lead-handoff` v1.7 (`findRun`, `newSessionCommand`, record read) and `work-folder-name` v1.1 (`isWorkFolder`). Rationale: `docs/adr/0056-hard-handover-outside-agent.md`.

A convenience on top of the hook: it gives the Lead the command for a new session, on every OS. **It only points.** It returns the command and starts nothing: no `node:child_process` in this script, no console, no terminal. The hand-over itself never needs it.

## Registration
`.mcp.json` at the plugin root: `{"mcpServers":{"lead-session":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/scripts/lead-session-mcp.mjs"]}}}`.
The tool name in Claude Code is `mcp__plugin_aico_lead-session__lead_new_session` (pattern `mcp__plugin_<plugin>_<server>__<tool>`, spike T1 with a server name without a hyphen; T5 confirms this exact name once in a live run and records it in `tests/lead-handover/evidence.md`). Server cwd = session cwd (spike T1), so the run is found from the cwd. The plugin cannot pre-approve the tool: expect one permission prompt per the CEO's settings. A refused prompt loses nothing, the command is also in the `context-guard` routes.

## Protocol
MCP over stdio: one JSON-RPC 2.0 object per line, UTF-8, LF. A line over 64 KiB is dropped and answered with `-32700`, id null. Only protocol lines on stdout; stderr stays silent. End of stdin: exit 0.
- `initialize`: answers the client's `protocolVersion` when it is a `YYYY-MM-DD` string, else `2025-06-18`; `capabilities` `{"tools":{}}`; `serverInfo` `{"name":"lead-session","version":<plugin.json version>}`.
- `notifications/initialized` and any other notification (no `id`): no answer.
- `ping`: empty result.
- `tools/list`: the one tool below.
- `tools/call`: below.
- Unknown method with an `id`: `-32601`. Bad JSON: `-32700`, id null. Bad `params`, unknown tool name or any argument given: `-32602`.

## Tool `lead_new_session`
No arguments: `inputSchema` `{"type":"object","properties":{},"additionalProperties":false}`. The slug comes from the active run, never from the model. Description: `Returns the command that starts a new Lead session after a context hand-over. Starts nothing.`

Read-only. On each call, in this order, stopping at the first that applies; a refusal is `isError: true` with the one text line, never a JSON-RPC error:
| Check | Text |
|---|---|
| No active run (`findRun`) | `refused: no run` |
| Name fails `isWorkFolder` | `refused: bad slug` |
| Run record broken or fails its file checks | `refused: broken record` |
| A `subs` entry of the run with `stop` null | `refused: step running` |
| Newest `handover` of the record is not trigger `context` | `refused: no context handover` |
| Own exception | `refused: error` |

Success, one text content, two lines:
```
Open a new terminal in the product folder and run:
<command>
```
`<command>` = `newSessionCommand(slug)`: `claude "aico lead hand-over: run lead-handover read '<name>' first, then follow skills/pipeline/references/lead-handover.md."`, the `lead-handoff` v1.4 fixed line inside double quotes. The name shape (`work-folder-name` v1.1) rules out quotes, `$`, backtick, `%`, `\` and control characters, so the line is one safe argument in cmd, PowerShell and POSIX shells when the CEO pastes it. Calling again returns the same text: no state, no record written.

## Limits (not enforceable)
- Tools are model-called: nothing forces the Lead to call it. A hook cannot call it. The `context-guard` routes hold without it.
- It does not close the old session; the CEO does. Called in another session of the same run it returns the same command, which is harmless.
- It appears in every Role's tool list as well. A Role calling it gets a refusal or the command and nothing changes.
- The server starts with each session. If it fails to start, no hand-over step depends on it.

## Personal data and destinations
Holds nothing. Reads the run's record and returns the work folder name in the command, to the Claude model of the session and the CEO's screen. No network, no file written, no recipient added.

## Error cases
Refusals above. Server down or tool not approved: the Lead uses the command from the freeze reason.

## Compatibility
New Contract, v1. A new tool, an argument, a new refusal text or any process start needs a new version; starting a process is a major bump and needs a security review.
