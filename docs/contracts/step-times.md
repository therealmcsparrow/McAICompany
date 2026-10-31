# Contract: step-times v1.1

v1.1 (task idea-20261030-2242-build-draft; additive): the active run name is checked with `isWorkFolder` (`work-folder-name` v1) before it is passed on, so a new name (with spaces and dots) is accepted and any other value writes nothing. Each `run-state` call stays `execFile` with fixed arguments, so no shell sees the name. Every v1 payload behaves as before.

Provider: `scripts/step-times.mjs` (Node built-ins only), wired by `hooks/hooks.json`. Consumer: `run-state` (`sub` event, v1.5), read by the Lead's report and scorecard.
Rationale: subagent start and stop times per Role, recorded without any Role doing anything. Time = receipt time; the payload has none.

## Hook entries
`hooks/hooks.json` holds `"hooks": { "SubagentStart": [...], "SubagentStop": [...] }` beside `"modules"`. Each entry is one command hook:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/step-times.mjs" start` (or `stop`) with `"timeout": 5` (seconds). `${CLAUDE_PLUGIN_ROOT}` is the only path in the command. Nothing is written under it.

## Input
The hook JSON on stdin, read until end of input, at most 64 KiB, parsed once; a longer input is dropped. Keys are read with `Object.hasOwn`. Only three fields are read:
- `agent_type` becomes `role`: an `agents/` slug, else `other`.
- `agent_id` becomes `id`: the first 12 hex characters of its SHA-256. The agent id is never stored or printed in clear. No `agent_id` (not a non-empty string of at most 512 characters) writes nothing.
- `session_id` becomes `session`, kept only when it matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, otherwise left out.
Every other field (`last_assistant_message`, transcript paths, `cwd`, the rest) never reaches the record.

## Flow
1. `run-state active --json` finds the active run; no active run, or a name that is not a work folder name, writes nothing.
2. `run-state sub <slug> <start|stop> <role> <id> [<session>]` appends one `sub` line. `run-state` stamps the time.
Each `run-state` call is `execFile(process.execPath, [fixed args])`: no shell, 3 s timeout, cut earlier if the script deadline is nearer.

## Never blocks
Exit code 0 on every path: bad or empty JSON, no active run, `run-state` error or timeout, an own exception, a bad phase argument. Exit 2 never occurs: on `SubagentStop` it keeps the subagent from stopping and runs the hook again. Nothing on stdout or stderr. The hook is waited for, so the script exits 0 itself 4 s after it starts, before the 5 s hook timeout.

## Compatibility
v1, v1.1 additive. A new field read from the payload, a non-zero exit code or a stored agent id is a major bump.
