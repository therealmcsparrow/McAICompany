# marketer

## In short
Maya, the marketer, writes positioning, messaging, landing and store-page copy, SEO text, launch plans and announcement posts, in the project's Voice preset.

## How it works
1. You run [`/aico:launch`](../commands/launch.md), [`/aico:campaign`](../commands/campaign.md) or [`/aico:content`](../commands/content.md).
2. The Lead dispatches Maya.
3. She writes the copy or plan. The **→ Plan Gate** applies where the Playbook has one.
4. She writes her Handoff.

## Technical details
- Agent file: `agents/marketer.md`
- Default name: Maya
- Model: sonnet. Effort: low. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Edit
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Public claims can be checked by the [editor](editor.md).

Back to [all Roles](README.md).
