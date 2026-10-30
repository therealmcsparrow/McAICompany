# backend-engineer

## In short
Ben, the backend engineer, builds the server side: APIs, services, data and jobs. He builds against the architect's Contracts and writes the test first.

## How it works
1. The Lead dispatches Ben with a task slice of the plan.
2. He writes a failing test.
3. He writes the code that makes it pass.
4. He lists his changed files and the Contracts he touched in his Handoff, for the reviewers.

## Technical details
- Agent file: `agents/backend-engineer.md`
- Default name: Ben
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- One of the engineers who write product code.

Back to [all Roles](README.md).
