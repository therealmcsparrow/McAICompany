# brand-artist

## In short
Bianca, the brand artist, proposes the Art direction and makes logos, icon sets, per-OS app icons, illustrations, and social, OG and store images. The output is editable SVG or code.

## How it works
1. The Lead dispatches Bianca for brand or image work.
2. She proposes the Art direction first.
3. She creates the assets as editable SVG or code.
4. She writes her Handoff listing the files.

## Technical details
- Agent file: `agents/brand-artist.md`
- Default name: Bianca
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.

Back to [all Roles](README.md).
