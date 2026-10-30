# ux-researcher

## In short
Uma, the UX researcher, plans usability tests with real people (scripts, screeners, surveys and consent) and turns their feedback into findings and Personas.

## How it works
1. The Lead dispatches Uma, for example in [`/aico:usability-test`](../commands/usability-test.md).
2. She plans the test: scripts, screeners, consent.
3. After the sessions she synthesizes the feedback into findings and Personas, in her Handoff.

## Technical details
- Agent file: `agents/ux-researcher.md`
- Default name: Uma
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Testers never edit source.

Back to [all Roles](README.md).
