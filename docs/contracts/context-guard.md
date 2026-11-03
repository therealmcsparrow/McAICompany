# Contract: context-guard v1

New Contract (task 2026-11-02 18.32 - Context Cap Hand Over, T2). Provider: `scripts/context-guard.mjs` (Node built-ins only), wired by `hooks/hooks.json`. Consumers: every Role and the Lead during an active run (they see only the refusals), `skills/handoff/SKILL.md` and `skills/pipeline/references/lead-handover.md` (they describe the result). Uses `lead-handoff` v1.7 (`HANDOVER_AT`, `findRun`, `transcriptTokens`, `contextHandover`, `newSessionCommand`, `claudeDirOf`, `workDir`, `lstatOrNull`, `openRegular`, `readSmall`, `iso`, `loadRecord`) and `run-state` v1.7 (`show`, read-only). Rationale: `docs/adr/0056-hard-handover-outside-agent.md`. Spike facts: `tests/lead-handover/evidence.md` (T1 spike section).

The hard hand-over at `HANDOVER_AT` (85500) of the fixed Context cap, done outside the agent: a hook refuses tools, so no model has to choose to stop.

## Hook entries
Two new command hooks in `hooks/hooks.json`, each with `"timeout": 5`, `${CLAUDE_PLUGIN_ROOT}` the only path in the command, and nothing written under it:
- `PreToolUse`, no matcher (every tool; on win32 the Lead uses PowerShell, so never match on `Bash`): `node "${CLAUDE_PLUGIN_ROOT}/scripts/context-guard.mjs" pre`.
- `SubagentStop`, beside the unchanged `step-times` entry: `node "${CLAUDE_PLUGIN_ROOT}/scripts/context-guard.mjs" subagent-stop`.

## Input
Stdin JSON, read until end of input, at most 4 MiB (a `Write` payload can be large), parsed once; longer input fails open. Keys are read with `Object.hasOwn`. Allow-listed fields only: `hook_event_name`, `transcript_path`, `session_id`, `agent_id`, `tool_name`, `tool_input.file_path`, `stop_hook_active`. Every other field, and the `content` of a `Write`, is never read or stored. The run is resolved from the hook process cwd, which is the session cwd also for a worktree Step (`skills/pipeline/references/worktrees.md`).

## Reading the context
- Lead (no `agent_id`): `transcript_path`, last assistant `usage` with `isSidechain` false.
- Step (`agent_id` present): `transcript_path` is the parent session there. The file is `<session-dir>/subagents/agent-<agent_id>.jsonl`, `<session-dir>` being `transcript_path` minus `.jsonl`; last assistant `usage` with `isSidechain` true (first lines can be metadata rows). `agent_id` must match `^[A-Za-z0-9_-]{1,128}$` before it is joined into a path; else unknown.
- Both: the `lead-handoff` token rule (input + cache creation + cache read + output, last 1 MiB, a regular file whose real path lies under the real `projects` folder of the Claude config dir). Transcript text is never read as instruction, stored or echoed. A missing file or no usage row is unknown.

## `pre`, in this order
1. `AICO_CONTEXT_GUARD=off` in the process env (this exact value): exit 0, silent.
2. Not `PreToolUse`, or tokens unknown, or tokens below `HANDOVER_AT`: exit 0, silent, no run scan (the fast path). Target under 200 ms per call, estimated, not measured; T3 measures it on win32.
3. No active run (`findRun`): exit 0, silent.
4. Step or Lead branch below.

### Step branch (`agent_id` present)
Both allowed cases need a `Write` whose `tool_input.file_path` resolves to a file that does not exist yet, directly in the real folder of the active run (`.company/work/<slug>/`, checks of `work-folder-name` v1.1).
- Allowed, Handoff: a name matching `^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.md$`. Appends `handoff` to the guard record. Exit 0 with no decision.
- Allowed, findings ledger (`handoff` v2.2, part 3): a name matching `^[0-9]{2,3}[a-z]?-[a-z0-9-]{1,64}\.findings\.md$`, when the guard record holds no `ledger` for this agent. Appends `ledger`, never `handoff`, to the guard record. Exit 0 with no decision. A second ledger name from the same agent is denied.
- Everything else: deny with the reason below; appends `deny` once per agent.
- Reason, exact text in `scripts/context-guard.mjs`: `aico context cap: this Step reached the hand-over point. Write your Handoff with status: handover to your Output path now, then end. Every other tool is refused.`

### Lead branch (no `agent_id`)
`<session>` = first 12 hex of the SHA-256 of `session_id`; no `session_id` (not a non-empty string of at most 512 characters): exit 0, silent. `<command>` = `newSessionCommand(slug)`. `L` = the frozen line below plus a space and `<command>`. `F` = the freeze reason below plus a space and `<command>`.
1. **Frozen**: the run record holds a `handover` with trigger `context` and this `<session>`. The tool `mcp__plugin_aico_lead-session__lead_new_session` is allowed. Any other tool is denied and the turn ends: stdout `{"continue":false,"stopReason":L,"systemMessage":L,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":L}}`, stderr `L`, exit 0.
2. **Step running** (a `subs` entry of the run with `stop` null): deny `Agent` and `Task` with the wait reason below; every other tool is allowed.
3. **Clean point**: `contextHandover` writes the Lead Handoff and the `handover` event (`lead-handoff` v1.7). Then the first-freeze deny, without `continue:false`, so the Lead keeps the turn to call the MCP tool or show the command: stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":F},"systemMessage":L}`, nothing on stderr, exit 0. The MCP tool itself is allowed instead, with no output. A concurrent call that loses the lock, or a failed write: allow, the next call re-reads the record.
- Freeze reason, exact text in `scripts/context-guard.mjs`: `aico context cap: the Lead Handoff is written and this session is frozen. Call lead_new_session, or show the CEO this command for a new session:`
- Wait reason, exact text in `scripts/context-guard.mjs`: `aico context cap: no new Step from this session. Wait for the running Step; the Lead Handoff is written after it.`
- Frozen line, exact text in `scripts/context-guard.mjs`: `aico context cap: this session is frozen. Start a new session in the product folder with:`

Routes for the command: the freeze reason (model-visible), `systemMessage` on the first-freeze deny and on every frozen deny, and stderr on a frozen deny (the CEO-visible routes: `stopReason` did not reach `result` in the spike; T4 records in `tests/lead-handover/evidence.md` which of these the CEO sees), the Lead Handoff `## Next`, and the MCP tool.

A plain deny is stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":<reason>}}`, exit 0.

## `subagent-stop`
Exit 0, silent, when: `AICO_CONTEXT_GUARD=off`, `stop_hook_active` true, no valid `agent_id`, no active run, or the record holds no `deny` for this agent. A `deny` and a `handoff` whose file exists as a regular file: also silent. A `deny` and no such `handoff`: stdout `{"decision":"block","reason":R}`, exit 0, once; the next stop arrives with `stop_hook_active` true and passes. A `ledger` never counts as a `handoff`.
- R, exact text in `scripts/context-guard.mjs`: `aico context cap: this Step was refused tools at the hand-over point. If your Handoff is not written yet, write it now with status: handover to your Output path. Then end.`

## Guard record
`.company/work/<slug>/context-guard.jsonl`. Append-only, one JSON object per line, at most 1000 lines of at most 512 bytes, created and opened under the `lead-handover.jsonl` file checks. Written by this script only, and only at or over `HANDOVER_AT`. No line number, because parallel Steps append at once. Keys in this order: `v` (1), `at` (UTC to the second), `ev`, `id`, then:
- `deny`: nothing more. At most one per `id`.
- `handoff`: `file` (the Handoff file name).
- `ledger`: `file` (the ledger file name). At most one per `id`.
`id` = first 12 hex of the SHA-256 of `agent_id`; the agent id is never stored in clear. A bad line is ignored. A full or unwritable record never lifts a deny; with no `deny` on record the stop passes. With a full, unreadable or unwritable record a new ledger is still allowed, unrecorded.

## Fail open
Unknown context, an own exception, or a hook timeout: the tool is allowed. A read failure must not brick every Step; `ledger add` exit 4 (`token-ledger`) still catches an over-cap Step after. The script exits 0 by itself 4 s after it starts. A `Write` that fails the path check is a deny, not an error. Nothing is printed on a silent path.

## Limits (not enforceable)
- The guard is a budget control, not a boundary against a prompt-injected or hostile Role: under the limit such a Role can switch it off (settings files, a hard link on its own transcript, closing the run in its state files).
- The reading lags one tool result, so one big read can pass 95000; `ledger add` exit 4 is the backstop.
- A hook stops a Step at any point, so a half-edit is possible. The fresh Role runs the tests first.
- After the one blocked stop a Step can still end without a Handoff; `handoff-lint` catches it. A Step that keeps calling refused tools burns turns until it ends; no hook result ends a subagent (not tested).
- A Step whose Output already exists cannot change it once refused; later edits by that Step are not in its Handoff. The fresh Role checks the tree.
- An existing findings ledger cannot be appended to once refused. Rows not yet in it go under the Handoff's `## Next` as plain lines with no `R-<n>` row shape, and the fresh reviewer adds them to the ledger. `handoff-lint --require-top` reads finding IDs from `## Blocking` and `## Nits` only: an ID there that the ledger lacks is the error `finding <id> missing from ledger`, while `## Next` lines are not checked. Until then the ledger misses those rows.
- `step-times` records a stop for a stop this hook then blocks, so the run can look clean to the Lead during that re-prompt.
- A stale `subs` entry keeps the Lead at Step running: unfrozen, and auto compaction stays blocked. Only manual `/compact` helps.
- Manual `/compact` in a frozen session lowers the reading and so unfreezes it: a CEO act. The CEO must not continue both that session and the new one.
- Dispatching the fresh Role and ending the old session stay outside the hook. The frozen session stays open until the CEO closes it.

## Personal data and destinations
Stores enums, UTC times, file names and truncated hashes of agent ids. No transcript text, no tool input, no CEO words. Deny reasons and the command go to the Claude model of the same session and to the CEO's screen; the guard record stays local under `.company/`. McSparrow adds no recipient (GDPR Art. 5(1)(c)).

## Error cases
| Case | Result |
|---|---|
| Below `HANDOVER_AT`, any tool | silent, exit 0 |
| Bad or oversize stdin, unknown tokens, own exception | allow, exit 0 |
| `agent_id` with a path character | tokens unknown, allow |
| `Write` to an existing file (a ledger included), another folder, a link or a bad name | deny |
| Second ledger name from one agent | deny |
| Frozen Lead, any tool but the MCP tool | deny, turn ends |
| Lead Handoff write refused or lost race | allow, retried on the next call |
| Run ended | no active run: silent |

## Compatibility
New Contract, v1. A new allowed tool, a new field read from stdin or a change in the fixed texts needs a new version. A changed threshold is a `lead-handoff` change.
