# market-researcher

## In short
Mateo, the market researcher, looks up demand, competitors, target users, pricing signals and EU flags for an idea. Every claim comes from a public source with a URL and a date.

## How it works
1. You run [`/aico:research`](../commands/research.md) or an idea flow that needs market facts.
2. The Lead dispatches Mateo, in parallel with the tech-researcher and design-researcher.
3. He searches public sources and writes sourced findings into his Handoff.
4. The product-manager builds the report from the researchers' Handoffs.

## Technical details
- Agent file: `agents/market-researcher.md`
- Default name: Mateo
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash, WebSearch, WebFetch
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Researchers write only their own Handoff and never install anything.

Back to [all Roles](README.md).
