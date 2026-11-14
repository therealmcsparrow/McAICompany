# Contract: mod-hook v1

New Contract (task P20261114.000001/01-feature; the brief calls it `aico.mod-hook` v1). What a rule may answer and how the one engine runs the rule table. Provider: the hook engine, scripts/hook-host.mjs with the rule table hooks/rules.json and the pins hooks/pins.json (created by the build), wired in `hooks/hooks.json`. Consumers: every rule module under hooks/rules/, the hook check script, `context-guard` v2.0 (the `cap` guard), the savers. Uses `hook-event` v1, `mod-manifest` v1, `aico-settings` v3.0. Rationale: `docs/adr/0071-guards-as-rule-table.md`, `docs/adr/0072-guards-before-release.md`.

## Rule function
`rule(event, snapshot) → verdict`, pure: no `fs`, `net`, `http`, `child_process`, `process`, `fetch` or dynamic `import`, and no read of the environment (AC21; the check scans each rule module and the shared path module). Input is the frozen `hook-event` v1 object and the frozen snapshot below.
Verdict (allow-list): `{ v: 'allow' }`, `{ v: 'deny', rule: '<rule ID>', message: '<1-300 printable chars>' }` or `{ v: 'note', rule: '<rule ID>', message: '…' }`. A deny or allow of rule `cap.M1` only may also carry `effect`: one of `cap-step-record`, `cap-lead-freeze`, `cap-lead-frozen`, `cap-warn`; the engine (pinned engine code, hooks/lib/cap-effects.mjs) then does the record writes and output shapes of `context-guard` v2.0. A rule never writes. Anything else (another key, another value, a changed event object, a thrown error, a promise) is invalid: a guard's invalid verdict is a deny `<rule ID>: invalid verdict`, a saver's is ignored (AC3). A rule never rewrites a payload: the engine never emits `updatedInput`.

## Rule table (hooks/rules.json, one row per rule ID)
`{ "event": "PreToolUse", "matcher": ["Bash","PowerShell"], "rule": "git-add.M-SEC1", "module": "git-add.mjs", "export": "judge", "fail": "closed", "timeoutMs": 300, "message": "aico guard git-add.M-SEC1: stage files by name" }`. `matcher` is a list of tool names or `["*"]`; `module` a file name in hooks/rules/; `fail` `closed|open`. Loaded only from the plugin root; a row whose rule ID has no manifest, or whose `fail` differs from its manifest, is unused (`mod-manifest` v1).

## Engine, per hook call
1. `env.guardsOff` and `event.session` is `lead` → no guard runs; savers run as usual. Once per session per active run, append `guards-off` to the guard record (`context-guard` v2.0) (AC16). In a `step` session `env.guardsOff` is ignored: Steps are always guarded, even when launched from a Lead with the switch on (CEO, Plan Gate). Only the CEO sets it, at launch; no tool call can reach the hook process environment.
2. Pins: SHA-256 of the engine files and of the rule table must equal hooks/pins.json (one hash for the engine, one for the table). Mismatch, or a file outside the plugin root → nothing loaded; every guard event denies `pins-mismatch`; the CEO is told at session start (AC19).
3. Snapshot (below) unreadable or invalid → guards deny `snapshot-invalid`; savers pass (AC17).
4. `event.drift` non-empty → guards deny `hook-payload-changed`; savers pass (AC18).
5. Guards first, in table order, then savers (Lead session only: a saver row never runs when `event.session` is `step`, AC28). The first guard deny wins; notes are collected.
6. Each rule has its own `timeoutMs` (at most 1000); the whole call ends by 3500 ms. A guard that throws, times out, or whose module is missing or unreadable → deny `<rule ID>: <error word>` (`crash`, `timeout`, `missing`, `unreadable`). A saver in the same case passes the call unchanged (AC9).

## Output to Claude Code
- Deny: stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"aico guard <rule ID>: <message>"}}`, exit 0. The `cap` guard may add `continue`, `stopReason` and `systemMessage` as in `context-guard` v2.0.
- Deny on `SubagentStop` (the `cap` guard's once-only block): stdout `{"decision":"block","reason":<reason>}`, exit 0; a `stop_hook_active` stop always passes.
- Note: `systemMessage` only (the CEO's screen); never `additionalContext`, so a saver adds no model tokens.
- Allow: no output, exit 0.
- `hooks/hooks.json` timeout for engine entries: 10 s, so the engine's own 3500 ms deadline always answers first. If Claude Code kills the hook anyway, the tool runs (host behaviour, outside aico; see Limits).

## Snapshot (Q-15)
The engine writes the resolved settings it needs (`threshold`, saver switches, `version` of `aico-settings`) to `<MCSPARROW_HOME or ~/.mcsparrow>/hook-snapshots/<root12>/` (`root12` = first 12 hex of SHA-256 of the real project root): `lead.json` at Lead `SessionStart` and at every `SubagentStart` (the Lead's next Step dispatch), and `step-<agentKey>.json` at `SubagentStart`. Written atomically (temp file, then rename), at most 4 KiB, `{ "v": 1, "at", "threshold", "savers": { "<id>": bool }, "floor": { "<role>": "haiku|sonnet|opus" }, "drift": bool, "settingsWarnings": [..] }` (`floor` from `company/model-floor.json`; unreadable → snapshot invalid). A Step reads its own file, else `lead.json`; a missing, partial or invalid file is `snapshot-invalid`. At most 200 Step files per root; the oldest are deleted. So a settings edit applies at the next Step dispatch, never mid-Step (AC17).

## Fixtures
Per rule ID a folder hooks/fixtures/<rule ID>/ with synthetic JSON events built from the schema file (never a real payload): at least one `pass-*.json` and one `block-*.json` for a guard; plus `crash`, `timeout`, `malformed` and `missing-module` cases run by the engine harness for every guard. A guard missing a pass or a block fixture fails the check and does not ship (AC4).

## Session start
At Lead `SessionStart` the engine runs every fixture against the loaded table and compares the event to the schema file. Any failure: one `systemMessage` to the CEO naming the rule IDs or fields, the snapshot records `drift: true`, savers are off for the session, guards deny `hook-payload-changed` (AC18). Budget: at most 2 s at session start.

## Latency budget
One engine process per hook call, never one per rule. PreToolUse with a transcript read (last 1 MiB): p95 at most 250 ms on win32, measured by the engine task on the CEO's machine and recorded in its Handoff; a run over it is a Nit for release 1, not a block.

## Limits (not enforceable)
- A hook the host kills at its own timeout lets the tool run. The 3500 ms engine deadline makes that rare; the spike task measures what the host does.
- Guards stop an agent, not a person: the CEO's off switch, a hand edit of the installed plugin or of `~/.claude/settings.json` outside a session are CEO acts.
- The plugin is the installed copy under `CLAUDE_PLUGIN_ROOT`. Developing aico with the plugin loaded from the source tree would put the source under self-protect; load the installed copy.

## Compatibility
New Contract, v1. A new verdict kind or a change in the engine order is a major; a new rule row or a new error word is a minor.
