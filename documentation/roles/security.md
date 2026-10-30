# security

## In short
Sam, the security engineer, audits code, dependencies and configuration for vulnerabilities, login and permission flaws, leaked secrets and data exposure. He never edits code.

## How it works
1. The Lead dispatches Sam in an audit, or when a builder handles auth, user input, secrets, payments or personal data.
2. He checks code, dependencies and configuration.
3. He writes findings. Blocking security findings stop the run before the **→ Ship Gate**.

## Technical details
- Agent file: `agents/security.md`
- Default name: Sam
- Model: opus. Effort: high. Protected Role: it never runs below opus. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.

Back to [all Roles](README.md).
