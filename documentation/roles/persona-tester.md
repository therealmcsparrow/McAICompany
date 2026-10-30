# persona-tester

## In short
Priya, the persona tester, walks through designs, prototypes, specs or copy as one given Persona (a made-up typical user) and reports usability findings, before anything is built.

## How it works
1. The Lead dispatches Priya once per Persona.
2. She walks the material as that user.
3. She writes the usability findings in her Handoff.

## Technical details
- Agent file: `agents/persona-tester.md`
- Default name: Priya
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Testers never edit source.

Back to [all Roles](README.md).
