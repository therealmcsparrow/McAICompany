# code-reviewer

## In short
Rui, the code reviewer, reads the finished branch diff and checks that it matches the spec, works, follows the standards and respects the Core, Module and Contract rules. He never edits code.

## How it works
1. The builders finish and the Lead dispatches Rui.
2. He reads the builders' Handoffs, then the diff against the base commit.
3. He sorts findings into blocking and nits. Blocking findings start a Fix round.
4. Before the **→ Ship Gate**, his review must pass.

## Technical details
- Agent file: `agents/code-reviewer.md`
- Default name: Rui
- Model: opus. Effort: high. Protected Role: it never runs below opus. Set the model with `roles.<role>.model` in `/aico:settings`.
- Tools: Read, Grep, Glob, Skill, Write, Bash
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Pilot for Handoff v1.1: with `pipeline.review_format: pilot` (default `plain`) it writes a top block and `ID | file:line | problem | why | fix` rows, and keeps a findings ledger. Depth follows the touched paths. See [Review](../concepts/review.md).

Back to [all Roles](README.md).
