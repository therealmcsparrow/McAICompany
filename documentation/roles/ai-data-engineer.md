# ai-data-engineer

## In short
Dev, the AI/data engineer, builds features that use language models, plus retrieval, data pipelines and analytics. Each is a Module behind a Contract, built with evals (checks of model output quality) and privacy in mind.

## How it works
1. The Lead dispatches Dev with a task slice of the plan.
2. He builds the feature as a Module behind its Contract.
3. He adds evals and keeps personal data in mind.
4. He writes his Handoff with the files changed.

## Technical details
- Agent file: `agents/ai-data-engineer.md`
- Default name: Dev
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- One of the engineers who write product code.

Back to [all Roles](README.md).
