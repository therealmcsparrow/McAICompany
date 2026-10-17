---
name: refactor
description: Playbook. Restructure existing code toward Core, Modules and Contracts in safe slices, with characterization tests and no behavior change.
disable-model-invocation: true
argument-hint: <scope>
---

# Playbook: refactor

Run with `aico:pipeline`. Start from an existing audit report if there is one; otherwise run `aico:audit` steps 1–2 first.

1. `aico:architect`: target Core list, Module map, Contracts, and slices (each slice moves one Module out).
   **→ Plan Gate**

Per slice, in order:

2. `aico:qa`: characterization tests of current behavior; they must pass before any change.
3. The owning engineer moves the code behind the Contract. No behavior change.
4. `aico:code-reviewer` ∥ `aico:qa` (the same tests must pass unchanged). Fix rounds per `aico:pipeline`.
   **→ Ship Gate** (per slice)

Follow-up work is proposed to the CEO, never started by the Lead.
