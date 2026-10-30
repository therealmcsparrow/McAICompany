# legal

## In short
Leila, the legal and compliance Role, handles privacy policies, terms, GDPR checks, cookie and consent text, marketing-claim checks and dependency license audits. Her output is a draft for you to review, not legal advice.

## How it works
1. The Lead dispatches Leila when a job touches privacy, terms, consent, claims or licenses.
2. She checks or drafts the text.
3. She writes her Handoff.

## Technical details
- Agent file: `agents/legal.md`
- Default name: Leila
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Never edits source code. Other Roles leave legal text to her.

Back to [all Roles](README.md).
