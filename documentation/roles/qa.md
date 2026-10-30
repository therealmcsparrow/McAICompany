# qa

## In short
Quinn, the QA tester, reproduces bugs, turns acceptance criteria into tests, writes contract tests for each Module and runs the suite. She edits test files only.

## How it works
1. The Lead dispatches Quinn, first in [`/aico:fix`](../commands/fix.md) to reproduce a bug.
2. She writes the failing test.
3. She runs the suite and records the result in her Handoff.

## Technical details
- Agent file: `agents/qa.md`
- Default name: Quinn
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Edits only tests.

Back to [all Roles](README.md).
