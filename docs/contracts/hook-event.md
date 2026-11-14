# Contract: hook-event v1

New Contract (task P20261114.000001/01-feature; the brief calls it `aico.hook-event` v1). Maps a raw Claude Code command-hook payload to aico's own event shape, so rules never read a raw payload. Provider: the hook engine's normalizer (pure module hooks/lib/event.mjs, fed by the host scripts/hook-host.mjs, both created by the build). Consumers: every rule function (`mod-hook` v1), the session-start drift check, the hook check script. Source of the field list: the spike (`.company/work/P20261114.000001/01-feature/03-prototype-backend-engineer.md` `## Answer` and `## Did`, Claude Code 2.1.325), committed as the schema file hooks/schema/hook-fields.json (names and types only, never a value; AC1).

## Raw input (allow-list; every other field is never read or stored)
Stdin JSON, at most 4 MiB (a larger input is malformed), parsed once, keys read with `Object.hasOwn`.
| Event | Fields read |
|---|---|
| all | `hook_event_name` str, `session_id` str, `transcript_path` str, `cwd` str |
| `SessionStart` | `source` str |
| `PreToolUse` | `tool_name` str, `tool_input` obj (fields below), `permission_mode` str; Step only: `agent_id` str, `agent_type` str |
| `SubagentStart` | `agent_id` str, `agent_type` str |
| `SubagentStop` | `agent_id` str, `agent_type` str, `agent_transcript_path` str, `stop_hook_active` bool |
| `Stop` | `stop_hook_active` bool |

`tool_input` fields: `Bash` and `PowerShell` `command`; `Read`, `Edit`, `MultiEdit`, `Write` `file_path`; `NotebookEdit` `notebook_path`; `Glob` `pattern`, `path`; `Grep` `path`, `glob`; `Agent` and `Task` `model`, `subagent_type`, `prompt` (only the dispatch lines below are kept). The `content`, `old_string`, `new_string` of a write are never read.

## Normalized event (frozen object, the only input a rule sees besides the snapshot)
```
{ v: 1, event, session: 'lead'|'step', sessionKey, agentKey|null, agentType|null,
  tool: { name, command|null, paths: [ { raw, real|null, exists: bool } ], model|null, subagentType|null, outputRole|null } | null,
  tokens: { state: 'none'|'read'|'error', total: int|null },
  env: { guardsOff: bool, subagentModel: string|null, subagentModelForce: string|null },
  protected: [ '<real path>' ],
  run: { slug, folder, stepRunning: bool, frozen: bool, agent: { deny: bool, handoff: bool, ledger: bool } } | null,
  drift: [ '<event>.<field>' ], stopHookActive: bool|null }
```
- `protected` (host-supplied, real paths, forward slashes, case-folded on win32): the plugin root (`CLAUDE_PLUGIN_ROOT`), the user settings file and the snapshot folder under `MCSPARROW_HOME` (else `~/.mcsparrow`), `~/.claude/settings.json`, `~/.claude/settings.local.json`, the project's `.claude/settings.json` and `.claude/settings.local.json`, the project's `.company/settings.json`, and the active run's `guard.jsonl`. Read by the `self-protect` guard only.
- `run` (host-supplied, only when tokens are at or over the cap module's fast-path floor): the active run (`run-state` `findRun`, folder checks of `context-guard` v1.1) and this session's and agent's facts from the guard record and run record. `null` when no run is active. Read by the `cap` guard only.
- `session`: `step` when `agent_id` is present, else `lead`. `sessionKey`, `agentKey` = first 12 hex of SHA-256 of `session_id`, `agent_id`; raw ids are never stored or shown. `agent_id` must match `^[A-Za-z0-9_-]{1,128}$` before it is joined into a path, else the event is malformed.
- `tool.paths`: every path-shaped input (`file_path`, `notebook_path`, `path`, Glob `pattern`, and up to 64 path-like tokens of a shell `command`), each with `real` = the host's real path (`fs.realpathSync.native`, which expands 8.3 short names on win32) when it exists, else `null`. Normalization of `raw` (slashes, case fold, `.` and `..` segments, trailing dots and spaces, stream suffix, device and UNC roots) is done by the rule through the shared path module, not here.
- `tool.outputRole`: the Role id from the prompt's `Output:` line (regex of `aico-mods` "Prompt line regexes", first 64 KiB), else `null`. `tool.subagentType`: the part after `aico:` of `subagent_type`, else `null`.
- `tokens`: host-read from the transcript, the token rule of `lead-handoff` (input + cache creation + cache read + output of the last assistant `message.usage`). Lead: `transcript_path`, rows with `isSidechain` false. Step: `agent_transcript_path` on `SubagentStop`, else `<transcript_path minus .jsonl>/subagents/agent-<agent_id>.jsonl`, rows with `isSidechain` true. File missing or no usage row yet → `{ state: 'none', total: 0 }` (a fresh session has used nothing). File present but unreadable, over the path checks of `lead-handoff`, or a malformed usage row → `{ state: 'error', total: null }`.
- `env`: read by the host from its own process environment once: `guardsOff` is true only for `AICO_GUARDS=off` exactly (the engine honours it in `lead` events only, `mod-hook` v1); `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` as strings (at most 64 characters) or `null`. A rule never reads the environment itself.
- `drift`: every required field of the event's row in the schema file that is missing or of another type. Extra fields are not drift.

## Error cases
| Case | Normalized result |
|---|---|
| Not JSON, over 4 MiB, unknown `hook_event_name`, bad `agent_id` | malformed: the engine applies the fail mode of each rule (`mod-hook` v1) |
| A required field missing or retyped | `drift` lists it; guards deny `hook-payload-changed`, savers pass (AC18) |
| Text in tool output or transcript saying "allow" | never read as instruction; no field carries tool output (AC10) |

## Personal data
The event holds tool names, paths, shell commands and model names in memory for one call. The schema file, fixtures, logs and records hold names, types, counts, rule IDs and hashes only (GDPR Art. 5(1)(c); CEO Q-21).

## Compatibility
New Contract, v1. A new optional field is a minor bump; a renamed or removed field is a major. A Claude Code change to the raw payload is handled by the schema file and the drift rule, not by a silent version change.
