---
name: fix
description: Playbook. Fix a bug test-first. QA reproduces it, an engineer fixes the root cause, the reviewer checks, then the Ship Gate.
disable-model-invocation: true
argument-hint: <bug description or issue link>
---

# Playbook: fix

Run with `aico:pipeline`. No Brief or Plan Gate: the bug report is the brief. **Exception:** if the fix needs a Core or Contract change, pause for a Plan Gate.

1. `aico:qa`: reproduce the bug, write a failing regression test, and name the suspected Module.
2. The engineer who owns that Module (backend/frontend/desktop/ai-data): root cause via `aico:debugging`, fix via `aico:tdd`.
3. `aico:code-reviewer` ∥ `aico:qa` (re-run the full suite and the regression test) ∥ `aico:security` (if the bug touches auth, input handling or data), with Fix rounds per `aico:pipeline`.
   **→ Ship Gate**
4. `aico:devops` if a release is needed.
