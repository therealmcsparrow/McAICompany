# desktop-engineer

## In short
Kenji, the desktop engineer, builds native apps for Windows, Linux and macOS. That covers working with the operating system, packaging, signing, installers and auto-update.

## How it works
1. The Lead dispatches Kenji with a task slice of the plan.
2. He builds the app as a plugin host plus Modules.
3. He handles packaging, signing, installers and auto-update.
4. He writes his Handoff with the files changed.

## Technical details
- Agent file: `agents/desktop-engineer.md`
- Default name: Kenji
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- One of the engineers who write product code.

Back to [all Roles](README.md).
