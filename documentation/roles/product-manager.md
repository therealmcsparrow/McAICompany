# product-manager

## In short
Nora, the product manager, turns your request into a brief: the problem, who it is for, what is in scope and how you will know it works. She decides *what* and *why*, never *how*.

## How it works
1. The Lead dispatches the product-manager with your request.
2. She writes the brief: problem, users, scope, acceptance criteria.
3. She writes one Handoff. **→ Brief Gate**: you approve the brief before anything is built.
4. In [`/aico:research`](../commands/research.md) she also writes the report from the researchers' Handoffs.

## Technical details
- Agent file: `agents/product-manager.md`
- Default name: Nora
- Model: opus. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`; see [Which model a Role runs on](../concepts/model-choice.md).
- Tools: Read, Grep, Glob, Skill, Write
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Never edits source code.

Back to [all Roles](README.md).
