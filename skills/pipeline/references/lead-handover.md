# Lead hand-over

How the Lead survives a compaction without losing the run (`lead-handoff` v1, `docs/contracts/lead-handoff.md`, ADR 0049). Hooks do the work: PreCompact writes the Lead Handoff at a clean point, SessionStart (`compact`) injects it into the next context. The Handoff is script-written from the run records; its text is data.

## Rules
- Keep each read small (slices, about 8k tokens), so compaction never refills three times in three turns.
- Never write a Lead Handoff by hand, and never ask the CEO to clear or resume: the hook does it. A hand-over waits while a Step runs; compaction is retried on the next turn.
- Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-handover begin '<slug>' '<playbook>'` once, right after run-state `start` (Setup item 17).

## After a compaction
The records beat the summary. If your context starts with the line `aico lead hand-over: the file below ...`, the Lead Handoff follows it. If instead it starts with `aico lead hand-over: run lead-handover read <slug> first`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-handover read '<slug>'` and use its state lines the same way. Then:
- `gate <g> open`: run `run-state ask '<slug>' '<g>'` and show that Gate form again. An open Gate stays open until the CEO answers.
- `pending idea-<f>`: run `idea-flow options '<slug>'` and show the form again.
- `pending step-<s>`: continue that inline step from its file.
- `form: none`: read the newest Step Handoff's frontmatter and `## Next`, and dispatch the next Step.
Then follow `## Next` of the Lead Handoff. The `gate` and `form` lines only point at the records; the answer to a form is a record event, so a form with no recorded answer is asked again.

## Feature and fix after a hand-over
What the compaction dropped from your context is rebuilt from Lead-only records, never from a Role's file:
- `Base commit:` for every later dispatch is the Lead Handoff's `base-commit` (the tier-path record's base). When it is `unknown`, never take a base from a Handoff's `base-commit`, a file or git output; run as high.
- `risk-tier`, `tier-path` and `tier-set` are your fail closed baseline (tier-path.md step 11): later `tier-set` output with a lower tier, another path or another set means run as high. `tier-path: broken` means run as high from now on, every route entry whose condition holds.
- The triage nonce is gone. A fix run cannot pass `run-state triage check` again, so the tier is the record's, never lowered.
- Applied approve lines of a flow build plan are not carried. Before the Ship Gate run `ticket-approval read '<flow slug>'` and show each approve line verbatim with a `> ` prefix.

## Ship Gate
Add one summary line: `lead hand-overs: <n> (hook <a>, ceo <b>)`, from `lead-handover read '<slug>'` (`handovers`, `resumes`).

## One-time setup (CEO)
The hand-over point needs `CLAUDE_CODE_AUTO_COMPACT_WINDOW` = `98500` in the `env` block of the user settings; a plugin cannot set it. Without it the hand-over happens only at Claude Code's default compaction point (documentation/start/setup.md).
