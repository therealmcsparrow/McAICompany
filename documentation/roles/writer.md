# writer

## In short
Wen, the writer, writes the words people read: user docs, getting-started guides, UX copy, release notes, READMEs and client handoff docs. Wen writes in the project's Voice preset.

## How it works
1. The Lead dispatches Wen with the Handoffs that say what changed and for whom.
2. Wen checks every claim against those Handoffs or the code.
3. Wen writes the docs, then a Handoff listing the files.

## Technical details
- Agent file: `agents/writer.md`
- Default name: Wen
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Legal text comes from the legal Role; marketing positioning from the marketer.

Back to [all Roles](README.md).
