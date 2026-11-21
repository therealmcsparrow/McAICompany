# Lead resume

The short boot path of a Lead session that starts or resumes a run after a hand-over (`lead-handoff`, `context-guard`, `lead-relay`). A fresh Lead (the subagent `aico:project-manager`, spawned by main with `aico resume: <slug> (<handover|answer|retry>)`; never read an answer from that prompt) already holds about 55k tokens before it reads anything, and the hand-over point is the run's handover, so read only what is listed here before the next Step. The full rules stay in `references/lead-handover.md`; open it by section when its case comes up, never whole.

## Boot, in this order
1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" lead-handover read '<slug>'` (`${CLAUDE_PLUGIN_ROOT}` is the base directory of the skill `aico:pipeline` without `/skills/pipeline`). The Lead Handoff path is on the `read` output; the answer to a form is only what `lead-relay read` prints.
2. Read the newest Step Handoff's frontmatter and `## Next` (a slice, not the file).
3. Act on the state lines:
   - `form: <id> open` or `gate <g> open`: run `run-state ask '<slug>' '<g>'` for a Gate, then `lead-relay read '<slug>' <id> --json`. `answer: none` → `lead-relay again '<slug>' <id>` and end with that `STATUS: needs-ceo` block; an answer → act on it (a Gate `run-state gate` passes only on that answer).
   - `pending idea-<f>`: run `idea-flow options '<slug>'`, open it with `lead-relay open` and end with its block.
   - `pending step-<s>`: continue that inline step from its file.
   - `form: none`: dispatch the next Step named by that `## Next`.
4. **Helper Lead** (`lead-relay`): you may spawn one `aico:project-manager` in the foreground only (never `run_in_background`); its `STATUS` block returns to you, and on its `needs-ceo` you run `lead-relay again '<slug>' <id>` and end with that block. A Role never spawns a Lead.
5. Dispatch rules: load the skill `aico:pipeline` (its `SKILL.md`) once, when the first dispatch is due.

## Do not load at boot
- The Playbook skill (`aico:fix`, `aico:feature`, `aico:lead` and the like): the Handoffs' `## Next` name the route.
- Other `references/` files and `lead-handover.md` as a whole. Open a section only for its case: `## Every run after a hand-over` (base commit, `unknown` values mean run as high), `## Ledger exit 4`, `## Step groups`, `## Ship Gate`.
- Any other skill (never `update-config`, whose body is 319 KB).

Base commit for every later dispatch is the Lead Handoff's `base-commit` (or the `read` line), never a Role's file. The records beat the summary.
