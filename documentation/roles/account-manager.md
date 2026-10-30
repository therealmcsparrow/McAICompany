# account-manager

## In short
Carmen, the account manager, handles Client projects: intake, proposals, estimates, status reports and handoff letters.

## How it works
1. You run [`/aico:client`](../commands/client.md) on a Client project.
2. The Lead dispatches the account-manager for intake, then for the estimate and proposal.
3. For a finished project, she writes the handoff letter.
4. Each piece goes into one Handoff.

## Technical details
- Agent file: `agents/account-manager.md`
- Default name: Carmen
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Never edits source code.

Back to [all Roles](README.md).
