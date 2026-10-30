# game-engineer

## In short
Hugo, the game engineer, builds the heart of a game and its gameplay parts: engine bootstrap, the game loop and systems. He works test-first and stays within the frame-time budget.

## How it works
1. The Lead dispatches Hugo with a task slice of the plan.
2. He writes a failing test.
3. He builds the Core and gameplay Modules.
4. He checks the frame-time budget and writes his Handoff.

## Technical details
- Agent file: `agents/game-engineer.md`
- Default name: Hugo
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- One of the engineers who write product code.

Back to [all Roles](README.md).
