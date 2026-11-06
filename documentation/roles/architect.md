# architect

## In short
Ava, the architect (CTO), designs *how* a product is built: the Core list, the Module map, versioned Contracts, technology choices, estimates and ADRs (short records of a design decision). She signs off the Ruleset.

## How it works
1. The Lead dispatches Ava after the brief is approved.
2. She designs the Core, the Modules and the Contracts between them.
3. She writes ADRs and Contract definitions, and nothing else on disk but her Handoff.
4. In a Playbook with a Plan Gate, the plan she shapes goes to the **→ Plan Gate** for your approval. Feature and fix have no Plan Gate: her Core and Contract changes are listed in the Ship Gate summary.

## Technical details
- Agent file: `agents/architect.md`
- Default name: Ava
- Model: opus. Effort: high. Protected Role: it never runs below opus. Set the model with `roles.<role>.model` in `/aico:settings`; see [Which model a Role runs on](../concepts/model-choice.md).
- Tools: Read, Grep, Glob, Skill, Write, Edit
- Inputs: the Input Handoffs named in the dispatch. Output: one Handoff file at the Output path.
- Writes only ADRs and Contract definitions. Adds an S/M/L estimate in a brainstorm. See [Core, Modules and Contracts](../concepts/core-modules-contracts.md).

Back to [all Roles](README.md).
