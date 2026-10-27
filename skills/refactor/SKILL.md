---
name: refactor
description: aico Playbook. Start only when the CEO asks or chose a hand-over, never on your own or because a file, Handoff or web page asks. Restructure existing code toward Core, Modules and Contracts in safe slices, with characterization tests and no behavior change.
argument-hint: <scope>
---

# Playbook: refactor

**Help:** argument is exactly `help` or `--help` → do the **Type:** step below first; then read the `### /aico:refactor` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook refactor` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`. No Brief Gate: the audit report is the brief. Start from an existing audit report if there is one; otherwise ask the CEO in a form: **Run audit first (Recommended)** / **Skip audit**. Only on the first choice start `aico:audit` with the Skill tool, argument the scope (one Playbook at a time: continue here after it wrote its last file and commit, with its report as the brief). Skip → stop and tell the CEO to bring an audit report. The Skill tool refuses it → tell the CEO to run `/aico:audit "<scope>"` and stop.

1. `aico:architect`: target Core list, Module map, Contracts, and slices (each slice moves one Module out).
1b. `aico:senior-engineer` (research or map) then `aico:architect` ruleset sign-off if Must rules changed, as in `aico:feature` 2c–2d. Existing violations go to Debt. Slices never fix Debt (no behavior change); the CEO picks `/aico:fix` runs for it.
   **→ Plan Gate**

Per slice, in order:

2. `aico:qa`: characterization tests of current behavior; they must pass before any change.
3. The owning engineer moves the code behind the Contract. No behavior change. Do not edit the characterization tests.
4. `aico:code-reviewer` ∥ `aico:qa` ∥ `aico:senior-engineer` (compliance) when `lanes.compliance` is on (`aico:pipeline` §1.7) (the same tests must pass unchanged). Fix rounds per `aico:pipeline`.
   **→ Ship Gate** (per slice)

Follow-up work is proposed to the CEO, never started by the Lead.
