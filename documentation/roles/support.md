# support

## In short
Sofia, the support Role, turns user reports, tickets and feedback into triaged, de-duplicated work the company can act on, with draft replies.

## How it works
1. You run [`/aico:feedback`](../commands/feedback.md) or hand the Lead user reports.
2. The Lead dispatches Sofia.
3. She groups duplicates, ranks the work and drafts replies.
4. She writes her Handoff.

## Technical details
- Agent file: `agents/support.md`
- Default name: Sofia
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Never edits source code.

Back to [all Roles](README.md).
