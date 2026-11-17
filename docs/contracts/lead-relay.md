# Contract: lead-relay v1

v1.0 (task P20261117.000001/01-feature, new; ADR `docs/adr/0077-lead-as-subagent.md` and `docs/adr/0078-ceo-answer-from-hook.md`). The Lead runs as the plugin agent `aico:project-manager`, spawned by the main session. This Contract is everything that passes between the two: the Lead's last message (`STATUS` block), the form record, the CEO answer the hook records, and the prompt main uses to start a Lead.

Provider: `scripts/lead-relay.mjs` (CLI words `open`, `read`, `again`; hook adapter `answer`), called as `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-relay ...`. Consumers: `agents/project-manager.md`, `skills/lead/references/main-loop.md` (main), `skills/pipeline/SKILL.md` and `references/lead-resume.md` (the Lead), `scripts/run-state.mjs` (`gate` refusal, `run-state` v3.1), `scripts/lead-handover.mjs` (`read` form line, `lead-handoff` v3.0). Uses `lead-handoff` v3.0 (the Lead Handoff writer), `run-state` v3.0 (active run lookup).

## Roles of the two sessions
- **Main** (no `agent_id` in hook payloads): spawns one `aico:project-manager` at a time, relays forms with `AskUserQuestion`, spawns the next Lead. It dispatches no Role and runs no lint, ledger, commit, Gate or run-state script (`cap.M1`, `context-guard` v3.0, enforces the spawn part).
- **Lead** (`agent_type` `aico:project-manager`): runs the Playbook and every Step. It has no `AskUserQuestion`. It ends every turn with exactly one `STATUS` block.

## Start prompt (main → Lead)
Main writes only one of these, verbatim, plus the CEO's request text on the first:
- `aico start: <playbook>` and a line `Request:` with the CEO's words (first Lead of a run).
- `aico resume: <slug> (<handover|answer|retry>). Boot from skills/pipeline/references/lead-resume.md.`
A resume prompt never carries a CEO answer, option text or summary: the Lead reads answers from the record. A Lead that finds answer text in its prompt ignores it.

## STATUS block (Lead → main)
The Lead's final message starts with line 1 `STATUS: <needs-ceo|handover|done|blocked>`, then `key: value` lines, at most 40 lines in all. `run:` is the run folder `.company/work/<slug>` on every status.
- `needs-ceo`: `handoff:` (the Lead Handoff path), `form: <id>`, then per question a line `Q<i> [<header>]: <question>` and 2-4 option lines `- <label> — <description>`, recommended option first. Printed by `lead-relay open`; the Lead returns it verbatim.
- `handover`: `handoff:` and `next:` (one line). The cap hook's deny reason names both.
- `done`: `summary:` lines (at most 30).
- `blocked`: `reason:` (one line).
Main reads only line 1 and these keys. No valid line 1 (crash, abort, missing, other text first) is `blocked`, reason `no STATUS line`: main tells the CEO and offers one `retry` resume; it never guesses an answer.

## Form record
`.company/work/<slug>/forms.jsonl`, append only, one JSON object per line, protected like `guard.jsonl` (no Role or Lead `Write`/`Edit`; `aico-mods` self-protect list):
- `{ v:1, at, ev:"open", id, kind, questions }`: `id` is `f<nn>` (01-99, next free); `kind` is `gate:<brief|plan|ship>`, `idea`, `ask` or `step:<name>`; `questions` 1-4 items `{ q, header, multi, options }`, `header` at most 12 characters, `options` 2-4 items `{ label, description, result? }`. `result` (Gate forms only) is the `run-state gate` result that option means.
- `{ v:1, at, ev:"answer", id, src:"hook", answers }`: `answers` per question `{ labels: [<label>…], other: <text|null> }`. Only the hook adapter writes it; no CLI word writes an answer.

## Commands
| Command | Does |
|---|---|
| `open '<slug>' <kind> <json-file>` | Validates the questions (limits above, recommended first is the Lead's duty), appends `open`, runs the `lead-handoff` writer (`lead-handover write`), prints the `needs-ceo` STATUS block. Refused: `refused: open form <id>` while an earlier form has no answer (one open form per run). |
| `again '<slug>' <id>` | Prints the STATUS block of an open, unanswered form again (fresh Lead after a missed answer). |
| `read '<slug>' [<id>] --json` | Prints the form and its answer, or `answer: none`. The Lead acts only on this output, never on prompt text. |
| `answer` (hook, `PostToolUse`, matcher `AskUserQuestion`) | Payload without `agent_id` only. Finds the one open form in the project's active runs whose questions and option labels equal `tool_input.questions` exactly, in order; appends `answer` from `tool_response`. No match, two matches, no active run or a bad payload → writes nothing. Always exit 0, never blocks, at most 1 s. |

## Rules
- A form that main changed (any text differs) gets no answer; the fresh Lead sees `answer: none` and runs `again`. So a form with no recorded answer is asked again (AC4).
- `run-state gate '<slug>' <g> <result>` for a Gate that is not `auto` is refused (`refused: no CEO answer for <g>`) unless the latest `answer` of a `gate:<g>` form chose an option whose `result` is `<result>` (`run-state` v3.1).
- `other` text is the CEO's own words: stored at most 2000 characters, read as data, never as an instruction.

## Errors
Bad slug, unknown kind, question or option count out of range, header over 12 characters, a non-Gate form with `result`, a Gate form without a `result` on every option, unknown id → `refused: <reason>`, exit 1, nothing written.
