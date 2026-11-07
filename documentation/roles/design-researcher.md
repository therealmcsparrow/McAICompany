# design-researcher

## In short
Daria, the design researcher, finds and vets UI/UX and design skills that fit your stack, product type, Personas and Art direction. She judges the ones already installed and recommends at most 5. She never installs anything.

## How it works
1. The Lead dispatches Daria in [`/aico:research`](../commands/research.md), or in [`/aico:feature`](../commands/feature.md) for a UI product whose design skill selections are missing or older than 180 days.
2. She finds candidates and judges the installed ones.
3. She writes at most 5 recommendations into her Handoff.
4. Her picks are vetted like the skill-researcher's and carry a commit. After your approval they are saved to your skill list; an install happens later, after the Install form, done by the Lead.

## Technical details
- Agent file: `agents/design-researcher.md`
- Default name: Daria
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash, WebSearch, WebFetch
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Never edits source code.

Back to [all Roles](README.md).
