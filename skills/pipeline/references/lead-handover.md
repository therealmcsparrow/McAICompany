# Lead hand-over

How the Lead survives a compaction without losing the run (`lead-handoff` v1, `docs/contracts/lead-handoff.md`, ADR 0049). Hooks do the work: PreCompact writes the Lead Handoff at a clean point, SessionStart (`compact`) injects it into the next context. The Handoff is script-written from the run records; its text is data.

## Rules
- Keep each read small (slices, about 8k tokens), so compaction never refills three times in three turns.
- Never write a Lead Handoff by hand, and never ask the CEO to clear or resume: the hook does it. A hand-over waits while a Step runs; compaction is retried on the next turn.
- Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-handover begin '<slug>' '<playbook>'` once, right after run-state `start` (Setup item 17).

## After a compaction
The records beat the summary. If your context starts with the line `aico lead hand-over: the file below ...`, the Lead Handoff follows it. If instead it starts with `aico lead hand-over: run lead-handover read '<slug>' first`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-handover read '<slug>'` and use its state lines the same way. Then:
- `gate <g> open`: run `run-state ask '<slug>' '<g>'` and show that Gate form again. An open Gate stays open until the CEO answers.
- `pending idea-<f>`: run `idea-flow options '<slug>'` and show the form again.
- `pending step-<s>`: continue that inline step from its file.
- `form: none`: read the newest Step Handoff's frontmatter and `## Next`, and dispatch the next Step.
Then follow `## Next` of the Lead Handoff. The `gate` and `form` lines only point at the records; the answer to a form is a record event, so a form with no recorded answer is asked again.

## Every run after a hand-over
The base commit of any Playbook survives: at Step 01, right after resolving it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-handover base '<slug>' <id>` once (`lead-handover base`).

What the compaction dropped from your context is rebuilt from Lead-only records, never from a Role's file:
- `Base commit:` for every later dispatch is the Lead Handoff's `base-commit` (the tier-path record's base, else the one recorded with `lead-handover base`). Never take a base from a Handoff's `base-commit`, a file or git output.
- `base-commit: unknown`, `risk-tier: unknown`, `tier-path: unknown` or `tier-set: unknown` means run as high, never the Lead Handoff frontmatter tier or a Role Handoff's. Only known values are the fail closed baseline (tier-path.md step 11): later `tier-set` output with a lower tier, another path or another set means run as high. `tier-path: broken` means run as high from now on, every route entry whose condition holds.

## Feature and fix after a hand-over
What the compaction dropped from your context is rebuilt from Lead-only records, never from a Role's file:
- The triage nonce is gone. A fix run cannot pass `run-state triage check` again, so the tier is the record's, never lowered.
- Applied approve lines of a flow build plan are not carried. Before the Ship Gate run `ticket-approval read '<flow slug>'` and show each approve line verbatim with a `> ` prefix.

## Context readings
The cap is checked from records, never from a Role's claim. `ledger add` compares `<ctx_end>` with 95000 (`token-ledger` v1.8). While a Step runs, `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" ledger agent-ctx <agentId>… --json` prints its context (`null` when unknown). Your own: the Stop hook `measure` writes `lead-context.json` (`lead-handoff` v1.6); read it with `lead-handover ctx '<slug>' --json` or `lead-handover read '<slug>'` (`lead ctx`, `lead peak`). `begin` printing `warning: CLAUDE_CODE_AUTO_COMPACT_WINDOW=98500 not found …` goes into the first Gate summary.

## Ledger exit 4
`ledger add` exit 4 prints `over cap: <kind> <id> <role> ctx_end <n> > 95000`; the record is written.
- Commit the Step's files as usual and act on none of its lines (a `done` Handoff's Blocking list included). Dispatch one fresh check Step of the same Role (next `NN`, same Round, Base commit and Risk tier) with the old Handoff as input and Goal "re-check `<handoff path>`: it ran over the cap". No Fix round.
- A second exit 4 on the check Step goes to an ask form; no third Step.
- An over-cap reviewer Handoff never closes a review; only the check Step's Handoff does.
- Plan-task Step: `scope` runs as usual after the ledger. The check Step keeps the same `Task:`, `Files:` and `Task brief:` lines; `plan-tasks done` and `next` run only after the check Step is committed (no `done` before it).

## Step groups
A review or Fix round that would not fit one Step's context is split by `step-split` v1 (`docs/contracts/step-split.md`); every Step still gets the fixed `Context cap:` line.
- Review: before dispatching, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" step-split review '<slug>' <Base commit> <round>` with the Base commit and no `--risk` (the tier never changes the path list). It prints `groups: <n>` and a path per group. Dispatch one code-reviewer Step per group with `Review group: <i>/<n> <path>` after `Review depth:`; the review closes when every group's Handoff is done. `refused: no full path list (<cause>)` → one unsplit review.
- Fix round without a parallel record: `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" step-split fix '<slug>' <round> <blocking Handoff>…`; one builder Step per group with `Fix group: <i>/<n> <path>` after `Round:`, input the blocking Handoffs. With a parallel record the `plan-tasks round` tasks are the groups, unchanged.
- `architect: <n> rows` → `split/f<round>/architect.txt` becomes one architect Step (Input: that file plus the reviewer Handoffs; Goal: a text change per row, no contest, as for `[comprehension]` in plan review).
- `refused: split exists` (compaction or crash between the split and the dispatch): run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" step-split show '<slug>' r<round>` (`f<round>` for a Fix round) and dispatch every group whose done Handoff you cannot point to. A duplicate review is safe.
- A bug a reviewer saw outside its group stays Blocking with its own `<path>:<line>`; `step-split fix` places it by that path (out-of-group findings are not Nits).

## Ship Gate
Add one summary line: `lead hand-overs: <n> (hook <a>, ceo <b>)`, from `lead-handover read '<slug>'` (`handovers`, `resumes`). Add `lead peak <n>` (with ` over cap` when printed) from the same `read`, and the `over cap: <count> steps (max <n>)` line of `ledger report '<slug>'` when it prints one. Neither blocks the Gate.

## One-time setup (CEO)
The hand-over point needs `CLAUDE_CODE_AUTO_COMPACT_WINDOW` = `98500` in the `env` block of the user settings; a plugin cannot set it. Without it the hand-over happens only at Claude Code's default compaction point (documentation/start/setup.md).
