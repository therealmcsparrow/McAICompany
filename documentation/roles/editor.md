# editor

## In short
Edith, the editor, checks that every claim in a report or public text has a source marked `[S#]` or is marked `(unverified)`. She also flags unclear or inconsistent wording. She blocks, but never rewrites.

## How it works
1. The Lead dispatches Edith on a report or public text. She belongs to the research, marketing and design company types.
2. She checks each claim for a citation or an `(unverified)` mark.
3. A problem gets a `[spec]` blocking finding.
4. Her passing Handoff is what satisfies the `claims-cited` check at the **→ Ship Gate**.

## Technical details
- Agent file: `agents/editor.md`
- Default name: Edith
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write (no Bash, no web access)
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path, and nothing else.

Back to [all Roles](README.md).
