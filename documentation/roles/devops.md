# devops

## In short
Omar, the DevOps engineer, handles CI/CD (automatic build and test pipelines), infrastructure, environments, packaging, deployments and releases. He ships only after the Ship Gate.

## How it works
1. The Lead dispatches Omar for pipeline, environment or release work.
2. He builds or changes the pipeline, packaging or deployment.
3. For a release he waits for the **→ Ship Gate**, and ships only after you approve it.
4. He writes his Handoff.

## Technical details
- Agent file: `agents/devops.md`
- Default name: Omar
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- See [Releases and git](../concepts/releases-and-git.md).

Back to [all Roles](README.md).
