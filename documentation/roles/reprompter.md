# reprompter

## In short
Lynn, the reprompter, turns a rough prompt into one complete, ready-to-use prompt: goal, context, inputs, constraints, output format and a done-check. She asks only when a gap would change the result. She never runs the prompt.

## How it works
1. You start [`/aico:reprompt`](../commands/reprompt.md) with your rough text.
2. The Lead dispatches the reprompter.
3. She asks only the questions that change the result.
4. She writes the complete prompt into her Handoff, and you choose what happens to it.

## Technical details
- Agent file: `agents/reprompter.md`
- Default name: Lynn
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Skill, Write
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Contract: `reprompt` v2.0 (see `docs/contracts/reprompt.md`).

Back to [all Roles](README.md).
