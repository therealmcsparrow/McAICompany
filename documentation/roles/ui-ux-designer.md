# ui-ux-designer

## In short
Yuki, the UI/UX designer, designs how a product works for its users: user flows, wireframes, screen states, design tokens (shared colours, sizes and fonts) and the design system.

## How it works
1. The Lead dispatches Yuki for a web or desktop product.
2. She designs the flows and screens, including empty and error states.
3. She records tokens and the design system.
4. She writes her Handoff for the frontend or desktop engineer.

## Technical details
- Agent file: `agents/ui-ux-designer.md`
- Default name: Yuki
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Loads the skills your Skills tab selections name for her, as the dispatch lists them, with the Skill tool.

Back to [all Roles](README.md).
