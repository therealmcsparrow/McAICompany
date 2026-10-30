# skill-researcher

## In short
Selin, the skill researcher, finds and vets third-party skills for your stack, product type, company type or design, and recommends at most 5. She has no Bash. She never adds a skill: the Lead does that after your approval.

## How it works
1. You ask for skill picks.
2. The Lead dispatches Selin for one area (stack, product-type, company-type or design).
3. She writes at most 5 recommendations into her Handoff.
4. The Lead scans every pick in a quarantine before you see it.
5. After your approval the Lead adds the skill, pinned to the scanned commit.

## Technical details
- Agent file: `agents/skill-researcher.md`
- Default name: Selin
- Model: sonnet. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, WebSearch, WebFetch (no Bash)
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Never edits source code and never installs.

Back to [all Roles](README.md).
