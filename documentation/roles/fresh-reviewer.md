# fresh-reviewer

## In short
Fenna, the fresh reviewer, reads a plan or a code diff as a newcomer would. She never sees the brief or the builders' notes. If the text alone does not make something clear, she says so. She never edits code.

## How it works
1. The Lead dispatches Fenna before the Plan Gate, and at high risk beside the second reviewer on a diff.
2. She writes the plan in her own words first.
3. She lists what the text does not make clear.
4. Her Handoff goes to the Lead before the **→ Plan Gate**.

## Technical details
- Agent file: `agents/fresh-reviewer.md`
- Default name: Fenna
- Model: opus. Effort: high. Protected Role: never runs below opus. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- See [The fresh reviewer](../concepts/review.md).

Back to [all Roles](README.md).
