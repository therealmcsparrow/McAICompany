# localizer

## In short
Lucía, the localizer, translates resource files into each supported language, so every language reads as if written natively. She edits only string resource files.

## How it works
1. The Lead dispatches Lucía when new or changed strings need translating.
2. She translates each supported language's resource file.
3. She writes her Handoff listing the files.

## Technical details
- Agent file: `agents/localizer.md`
- Default name: Lucía
- Model: haiku. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Edits only string resource files.

Back to [all Roles](README.md).
