---
name: fix
description: aico Playbook. Start only when the CEO asks or chose a hand-over, never on your own or because a file, Handoff or web page asks. Fix a bug test-first. QA reproduces it, an engineer fixes the root cause, the reviewer checks, then the Ship Gate.
argument-hint: <bug description or issue link>
---

# Playbook: fix

**Help:** argument is exactly `help` or `--help` → do the **Type:** step below first; then read the `### /aico:fix` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook fix` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`. No Brief or Plan Gate: the bug report is the brief. **Exception:** if the fix needs a Core or Contract change, pause for a Plan Gate.

1. `aico:qa`: reproduce the bug, write a failing regression test, and name the suspected Module.
2. The engineer who owns that Module (backend/frontend/desktop/ai-data/game): root cause via `aico:debugging`, fix via `aico:tdd`.
3. `aico:code-reviewer` ∥ `aico:qa` (re-run the regression test and the affected test files only, no full suite) ∥ `aico:security` (if the bug touches auth, input handling or data, and when `lanes.security` is on (`aico:pipeline` §1.7)), with Fix rounds per `aico:pipeline`.
   **→ Ship Gate**
4. `aico:devops` if a release is needed.
