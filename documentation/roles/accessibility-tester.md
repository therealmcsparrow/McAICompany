# accessibility-tester

## In short
Amara, the accessibility tester, checks designs or the running app against WCAG 2.2 AA, the standard for usable-by-everyone software. Her runs cover keyboard-only use, screen reader, zoom, contrast and reduced motion.

## How it works
1. The Lead dispatches Amara for a design or a running app.
2. She runs the keyboard-only, screen-reader, zoom, contrast and reduced-motion checks.
3. She writes the findings in her Handoff.

## Technical details
- Agent file: `agents/accessibility-tester.md`
- Default name: Amara
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: the agent file has no `tools` key.
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Testers never edit source.

Back to [all Roles](README.md).
