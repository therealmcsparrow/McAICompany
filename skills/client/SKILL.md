---
name: client
description: Playbook for Client projects. Intake to brief, estimate and proposal; or, with "handoff", package finished work for the client.
disable-model-invocation: true
argument-hint: intake <client request> | handoff
---

# Playbook: client

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `client` and stop.

Run with `aico:pipeline`. Set `engagement: client` in `.company/project.md`, and the client's license and jurisdiction.
Anything sent to the client always asks at the Ship Gate, whatever the settings say (`aico:pipeline` §4).

## intake
1. `aico:account-manager`: intake (goals, constraints, budget, deadline, open questions for the client).
2. `aico:product-manager`: brief and acceptance criteria.
3. `aico:architect`: proposed Core/Modules and an effort estimate per Module (S/M/L plus a range in days).
   **→ Brief Gate**
4. `aico:account-manager`: proposal (scope, phases, estimate, assumptions, what's excluded) in the client's voice preset.
   **→ Ship Gate** (before sending anything to the client)

Building then runs through `aico:feature`, started by the CEO.

## handoff
1. `aico:writer` ∥ `aico:devops`: user/admin docs, plus deployment/runbook, environment and credentials checklist (no secrets in files).
2. `aico:legal`: license and IP transfer check against the proposal.
3. `aico:account-manager`: handoff letter with what was delivered vs. scope, and known issues.
   **→ Ship Gate**
