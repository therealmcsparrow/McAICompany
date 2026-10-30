# frontend-engineer

## In short
Freya, the frontend engineer, builds the parts of a web app people see. Each part plugs into the app shell through a Contract. Her work is accessible, responsive and test-first.

## How it works
1. The Lead dispatches Freya with a task slice of the plan and the design.
2. She writes a failing test.
3. She builds the UI Module so it registers with the app shell through its Contract.
4. She writes her Handoff with the files changed.

## Technical details
- Agent file: `agents/frontend-engineer.md`
- Default name: Freya
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- One of the engineers who write product code.

Back to [all Roles](README.md).
