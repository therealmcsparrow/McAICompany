# hands-on-tester

## In short
Hana, the hands-on tester, uses the running web or desktop app for real, through browser or computer-use tools, and reports usability findings with screenshots.

## How it works
1. The Lead dispatches Hana once per Persona.
2. She uses the running app as that Persona.
3. She writes findings with screenshots in her Handoff.

## Technical details
- Agent file: `agents/hands-on-tester.md`
- Default name: Hana
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: the agent file has no `tools` key.
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Testers never edit source.

Back to [all Roles](README.md).
