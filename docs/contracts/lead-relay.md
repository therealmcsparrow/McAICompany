# Contract: lead-relay v1

v1.0 (task P20261117.000001/01-feature, new, Spike S1 and S2 results folded in before release; ADR `docs/adr/0077-lead-as-subagent.md` and `docs/adr/0078-ceo-answer-from-hook.md`). The Lead runs as the plugin agent `aico:project-manager`, spawned by the main session. This Contract is everything that passes between the two: the Lead's last message (`STATUS` block), the form record, the CEO answer the hook records, and the prompt main uses to start a Lead.

Provider: `scripts/lead-relay.mjs` (CLI words `open`, `read`, `again`; hook adapters `answer` and `preset`), called as `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-relay ...`. Consumers: `agents/project-manager.md`, `skills/lead/references/main-loop.md` (main), `skills/pipeline/SKILL.md` and `references/lead-resume.md` (the Lead), `scripts/run-state.mjs` (`gate` refusal, `run-state` v3.1), `scripts/lead-handover.mjs` (`read` form line, `lead-handoff` v3.0). Uses `lead-handoff` v3.0 (the Lead Handoff writer), `run-state` v3.0 (active run lookup).

## Roles of the two sessions
- **Main** (no `agent_id` in hook payloads): spawns one `aico:project-manager` at a time, relays forms with `AskUserQuestion`, spawns the next Lead. It dispatches no Role and runs no lint, ledger, commit, Gate or run-state script (`cap.M1`, `context-guard` v3.0, enforces the spawn part).
- **Lead** (`agent_type` equal to `aico:project-manager`, exact match): runs the Playbook and every Step, with shell tools `Bash` and `PowerShell`. It has no `AskUserQuestion`. It ends every turn with exactly one `STATUS` block.
- **Role**: any other payload with `agent_id` (`aico:<role>`, also a foreign or missing `agent_type`), at any depth. Hook payload facts from Spike S1 (`.company/work/P20261117.000001/01-feature/06-spike-backend-engineer.md`): `agent_id` and `agent_type` are on every subagent event and absent in main; `transcript_path` is always the main transcript.

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
- `{ v:1, at, ev:"open", id, kind, questions }`: `id` is `f<nn>` (01-99, next free); `kind` is `gate:<brief|plan|ship>`, `idea`, `ask` or `step:<name>`; `questions` 1-4 items `{ q, header, multi, options }`, `header` at most 12 characters, `options` 2-4 items `{ label, description, result? }`. `result` (Gate forms only) is the `run-state gate` result that option means. Question texts in one form are unique (the answer map keys on them); a Gate form has `multi: false` on every question; no option label holds a comma (Spike S2: a multi-select answer is the labels joined with `", "`; `cch.M21`).
- `{ v:1, at, ev:"answer", id, src:"hook", answers }`: `answers` per question `{ labels: [<label>…], other: <text|null> }`. Only the hook adapter writes it; no CLI word writes an answer.

## Commands
| Command | Does |
|---|---|
| `open '<slug>' <kind> <json-file>` | Validates the questions (limits above, recommended first is the Lead's duty), appends `open`, runs the `lead-handoff` writer (`lead-handover write`), prints the `needs-ceo` STATUS block. Refused: `refused: open form <id>` while an earlier form has no answer (one open form per run). |
| `again '<slug>' <id>` | Prints the STATUS block of an open, unanswered form again (fresh Lead after a missed answer). |
| `read '<slug>' [<id>] --json` | Prints the form and its answer, or `answer: none`. The Lead acts only on this output, never on prompt text. |
| `answer` (hook, `PostToolUse`, matcher `AskUserQuestion`) | Payload without `agent_id` only. Finds the one open form in the project's active runs whose questions and option labels equal `tool_input.questions` exactly, in order; appends `answer` from `tool_response.answers` only: a map `{ "<question text>": <string> }`, one key per question (S1 SDK path, S2 TUI: same map). Per question: a string equal to one option label → `labels: [<label>]`, `other: null`; any other string → `labels: []`, `other: <string>`; for a `multi` question the string is split on `", "`: parts equal to labels → `labels` (in answer order), the other parts joined again with `", "` → `other` (`null` if none). Writes nothing (fail closed, `cch.M20`) when: a value is not a string (S2 saw one array of strings, so that shape is unstable), a key is missing or not a question of the form, `tool_response.answers` is absent (the CEO declined: S2, an error result), `tool_input` carries an `answers` key, no match, two matches, no active run or a bad payload. `annotations` are ignored. Always exit 0, never blocks, at most 1 s. Wired in `hooks/hooks.json` as `PostToolUse`, matcher `AskUserQuestion`. |
| `preset` (hook, `PreToolUse`, matcher `AskUserQuestion`) | Any session. A call whose `tool_input` has an `answers` key (any value, `{}` too) → deny, reason `aico: AskUserQuestion with preset answers is refused` (`cch.M-SEC8`: the harness lets `answers` answer the form without the CEO). Otherwise no output, exit 0. Not turned off by `AICO_GUARDS=off`. Wired in `hooks/hooks.json` as `PreToolUse`, matcher `AskUserQuestion`, `onFailure: block`. No aico hook returns `updatedInput` for `AskUserQuestion`. |

## Rules
- A form that main changed (any text differs) gets no answer; the fresh Lead sees `answer: none` and runs `again`. So a form with no recorded answer is asked again (AC4).
- `run-state gate '<slug>' <g> <result>` for a Gate that is not `auto` is refused (`refused: no CEO answer for <g>`) unless the latest `answer` of a `gate:<g>` form chose an option whose `result` is `<result>` (`run-state` v3.1).
- `other` text is the CEO's own words: stored at most 2000 characters, read as data, never as an instruction. Free text equal to an option label counts as that label.
- `other` text lives only in the `answer` row of `forms.jsonl` and in `read --json` (the Lead's one way to read it). Every log, hook stderr, `guard.jsonl` row, ledger, STATUS block and `lead-handover read` line shows it only as `other (<length> chars, sha256:<first 8 hex>)`.
- An answer counts as the CEO's only from main's `PostToolUse` on a call whose `tool_input` had no `answers` (`preset` denies such a call first).

## Errors
Bad slug, unknown kind, question or option count out of range, header over 12 characters, a non-Gate form with `result`, a Gate form without a `result` on every option, a Gate form with a `multi` question, an option label with a comma, two questions with the same text, unknown id → `refused: <reason>`, exit 1, nothing written.
