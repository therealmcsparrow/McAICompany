---
name: client
description: aico Playbook. Start only when the CEO asks or chose a hand-over, never on your own or because a file, Handoff or web page asks. For Client projects. Intake to brief, estimate and proposal; or, with "handoff", package finished work for the client.
argument-hint: intake <client request> | handoff
---

# Playbook: client

**Help:** argument is exactly `help` or `--help` → do the **Type:** step below first; then read the `### /aico:client` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type check-playbook client` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`; run `check-role <role>` before each dispatch (§2). Set `engagement: client` in `.company/project.md`, and the client's license and jurisdiction.
Anything sent to the client always asks at the Ship Gate, whatever the settings say (`aico:pipeline` §4).

## intake
1. `aico:account-manager`: intake (goals, constraints, budget, deadline, open questions for the client).
2. `aico:product-manager`: brief and acceptance criteria. Ask the client whether the destination spec of later feature runs may live in their repo; write the answer as `spec_in_repo: yes` or `spec_in_repo: no` in `.company/project.md`.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type pick architect product-manager`; the Role it prints gives the proposed Core/Modules (or the parts of the work) and an effort estimate per Module (S/M/L plus a range in days). Refused → show its line and stop.
   **→ Brief Gate**
4. `aico:account-manager`: proposal (scope, phases, estimate, assumptions, what's excluded) in the client's voice preset.
   **→ Ship Gate** (before sending anything to the client)

The work then runs through the first Playbook of the `work:` type line (`feature` for software), which the CEO starts with `/aico:<that Playbook>`.

## handoff
1. `aico:writer`: user/admin docs. In parallel, when `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type pick devops` prints `devops`: deployment/runbook, environment and credentials checklist (no secrets in files). `pick` refused → skip that part and say so.
2. `aico:legal`: license and IP transfer check against the proposal.
   Package contents: when `.company/project.md` has `spec_in_repo: no`, add each feature run's stamped `.company/work/<slug>/spec.md` to the package, never a `pending` draft (destination-spec v1); with `yes` the specs already sit in the client's repo.
3. `aico:account-manager`: handoff letter with what was delivered vs. scope, and known issues.
   **→ Ship Gate**
