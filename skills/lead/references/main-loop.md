# Main loop (the main session)

Main only relays. The Lead agent `aico:project-manager` runs the Playbook (`lead-relay`, `docs/contracts/lead-relay.md`). Main runs no Step, lint, ledger, commit, Gate or run-state script.

## Start
`aico start: <playbook>` plus a line `Request:` with the CEO's words counts as "the CEO asks" in a Playbook description. Spawn one `aico:project-manager` in the foreground, never with `run_in_background` (a background spawn is denied). Only main spawns the Lead; one at a time. The prompt is exactly:
- first Lead: `aico start: <playbook>` and `Request: <the CEO's words>`.
- later: `aico resume: <slug> (<handover|answer|retry>). Boot from skills/pipeline/references/lead-resume.md.` (boot reference `lead-resume.md`). Never put an answer, option text or summary in it.

## Read the result
Read only line 1 `STATUS: <value>` and the `key: value` lines. Branches:
- `needs-ceo`: build one `AskUserQuestion` from the STATUS lines only: per `Q<i>` line `question`, `header`; `(multi)` marker → `multiSelect: true`, else false; each `- <label> — <description>` option in the printed order. Change no text (a changed form gets no answer). Never preset `answers`. Answered → spawn `aico resume: <slug> (answer)`. The hook records the answer; main never relays it.
- Declined (no `answers` returned): spawn no Lead and do not loop. Tell the CEO one line: `aico: run <slug> waits on form <id>; say resume to be asked again`, and end the turn. On "resume", spawn `aico resume: <slug> (answer)`.
- `handover`: spawn `aico resume: <slug> (handover)`.
- `done`: show the `summary:` lines; stop.
- `blocked`: show `reason:`; stop.
- no STATUS line first (crash, abort, other text): treat as `blocked`, reason `no STATUS line`; tell the CEO and offer one `retry` (`aico resume: <slug> (retry)`). A second failure stops; never guess an answer.
