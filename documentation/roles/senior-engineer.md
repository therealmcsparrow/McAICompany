# senior-engineer

## In short
Erik, the senior engineer, researches sourced best-practice rules for every tool in your stack and keeps them as the Ruleset. He maps rules to plan tasks and checks diffs against them. Security is law.

## How it works
1. The Lead dispatches Erik to build or refresh the Ruleset, or to check a diff.
2. He researches rules per tool, each with a source.
3. He maps the rules to the tasks in the plan.
4. After the builders finish, he checks the diff against the rules (compliance) and writes his findings.

## Technical details
- Agent file: `agents/senior-engineer.md`
- Default name: Erik
- Model: opus. Effort: medium. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash, WebSearch, WebFetch
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Writes only rule packs and the Ruleset. Never edits source.
- With `pipeline.review_format: pilot` (default `plain`) it writes findings as `ID | file:line | problem | why | fix` rows. See [Ruleset and debt](../concepts/ruleset-and-debt.md).

Back to [all Roles](README.md).
