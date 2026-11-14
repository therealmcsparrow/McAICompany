# Hook field schema

`hook-fields.json` lists the Claude Code command-hook payload fields the hook engine reads, by event, as field name and type word only. No payload value is ever stored here.

## Layout
- One row per `hook_event_name` (`SessionStart`, `PreToolUse`, `SubagentStart`, `SubagentStop`).
- `required`: fields the engine needs; a missing one or one of another type is drift (`hook-event` v1, `drift`).
- `optional`: fields that may be absent. `agent_id` and `agent_type` on `PreToolUse` appear only in a Step session; the Lead session has none.
- `tool_input` (under `PreToolUse`): the per-tool fields read, each present only for the tools named in `hook-event` v1 "Raw input".
- `transcript_assistant_row`: the transcript fields the cap and model-floor guards read. The transcript layout is not a documented interface, so a change shows up as drift.
- Extra fields in a payload are not drift.

## Source
Live probe of a Lead session and one Step session on Claude Code 2.1.325, logging key names and types only. The probe found a field for each guard: tokens and model from the transcript, `tool_name`, `tool_input.*` and `agent_id` from the payload. Version pinning lives here, not in the JSON, so the file holds no version value.

Findings by field:
- No payload carries a model or token count; both come from the last assistant row of the transcript (`transcript_path` for the Lead, `agent_transcript_path` for a Step).
- `SubagentStop` `transcript_path` is the parent session, so the Step file comes from `agent_transcript_path`.
- `SubagentStart` and `SubagentStop` fields are the same in 2.1.325 for `agent_id` and `agent_type`.
- Not probed: an `Agent` call without `model`, a Step-to-Step dispatch, and a Step's first call before it has an assistant row (treated as no usage yet).

## Change rule
Add a field only after a probe shows it. A Claude Code change to a payload is handled here and by the drift check, not by a silent contract change.
