# Lead resume

The short boot path of a Lead session that starts or resumes a run after a hand-over (`lead-handoff` v1.8, `context-guard` v1). A fresh Lead already holds about 55k tokens before it reads anything, and the hand-over point is 85500, so read only what is listed here before the next Step. The full rules stay in `references/lead-handover.md`; open it by section when its case comes up, never whole.

## Boot, in this order
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-handover read '<slug>'` (`${CLAUDE_PLUGIN_ROOT}` is the base directory of the skill `aico:pipeline` without `/skills/pipeline`). If your context starts with `aico lead hand-over: the file below ...`, the Lead Handoff follows it; use that instead and skip `read`.
2. Read the newest Step Handoff's frontmatter and `## Next` (a slice, not the file).
3. Act on the state lines:
   - `gate <g> open`: run `run-state ask '<slug>' '<g>'` and show the Gate form again.
   - `pending idea-<f>`: run `idea-flow options '<slug>'` and show the form again.
   - `pending step-<s>`: continue that inline step from its file.
   - `form: none`: dispatch the next Step named by that `## Next`.
4. Dispatch rules: load the skill `aico:pipeline` (its `SKILL.md`) once, when the first dispatch is due.

## Do not load at boot
- The Playbook skill (`aico:fix`, `aico:feature`, `aico:lead` and the like): the Handoffs' `## Next` name the route.
- Other `references/` files and `lead-handover.md` as a whole. Open a section only for its case: `## Every run after a hand-over` (base commit, `unknown` values mean run as high), `## Ledger exit 4`, `## Step groups`, `## Ship Gate`.
- Any other skill (never `update-config`, whose body is 319 KB).

Base commit for every later dispatch is the Lead Handoff's `base-commit` (or the `read` line), never a Role's file. The records beat the summary.
