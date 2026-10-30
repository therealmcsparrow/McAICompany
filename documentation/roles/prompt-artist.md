# prompt-artist

## In short
Iris, the prompt artist, writes art direction and reproducible prompts for image models, for hero images, illustrations, backgrounds and concept art. You run the prompts yourself.

## How it works
1. The Lead dispatches Iris for image-model prompts.
2. She writes the art direction and the prompts.
3. She puts them in her Handoff. You run them in your image tool.

## Technical details
- Agent file: `agents/prompt-artist.md`
- Default name: Iris
- Model: haiku. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Runs no image model itself.

Back to [all Roles](README.md).
