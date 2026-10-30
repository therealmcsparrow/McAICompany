# game-artist

## In short
Gabriel, the game artist, makes sprites, tilesets, sprite sheets, 3D asset briefs, shaders and VFX direction. His specs are ready for the game engine, with Blender exports.

## How it works
1. The Lead dispatches Gabriel for game art.
2. He makes the assets or briefs with engine-ready specs.
3. He writes his Handoff listing the files.

## Technical details
- Agent file: `agents/game-artist.md`
- Default name: Gabriel
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.

Back to [all Roles](README.md).
