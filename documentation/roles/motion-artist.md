# motion-artist

## In short
Milo, the motion artist, makes things move: micro-interactions, transitions, loading and empty-state animations, Lottie and CSS animations, and demo storyboards.

## How it works
1. The Lead dispatches Milo for animation work.
2. He designs the motion and builds it as Lottie or CSS.
3. He writes his Handoff listing the files.

## Technical details
- Agent file: `agents/motion-artist.md`
- Default name: Milo
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.

Back to [all Roles](README.md).
