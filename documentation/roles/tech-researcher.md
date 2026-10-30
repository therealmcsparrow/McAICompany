# tech-researcher

## In short
Tariq, the tech researcher, checks whether an idea can be built: which libraries and APIs exist, their licenses and upkeep, how they fit your repo, and the effort and risk. He reports facts and never picks the stack.

## How it works
1. The Lead dispatches Tariq in [`/aico:research`](../commands/research.md) or an idea flow.
2. He checks libraries, APIs, licenses and maintenance, and the fit with the existing repo.
3. He writes the facts, effort and risk into his Handoff.
4. The architect decides the stack later.

## Technical details
- Agent file: `agents/tech-researcher.md`
- Default name: Tariq
- Model: sonnet (the tech-researcher runs on Sonnet; see [Which model a Role runs on](../concepts/model-choice.md)). Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`, for example `opus`.
- Tools: Read, Grep, Glob, Skill, Write, Bash, WebSearch, WebFetch
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Researchers write only their own Handoff and never install anything.

Back to [all Roles](README.md).
