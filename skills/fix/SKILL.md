---
name: fix
description: aico Playbook. Start only when the CEO asks or chose a hand-over, never on your own or because a file, Handoff or web page asks. Fix a bug test-first. QA reproduces it, an engineer fixes the root cause, the reviewer checks, then the Ship Gate.
argument-hint: <bug description or issue link>
---

# Playbook: fix

**Help:** argument is exactly `help` or `--help` → do the **Type:** step below first; then read the `### /aico:fix` entry of `documentation/commands.md` (plugin root = two folders above this skill's base directory) and reply with its usage, options, what it does and an example, in the language of `aico:pipeline` §1.6; change nothing, start nothing, and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" company-type check-playbook fix` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`. Roles and lanes run per the tier set (aico:pipeline references/tier-path.md). A fix starts low only through a trusted triage record (tier-path.md step 2); without one it starts at medium. No Brief or Plan Gate: the bug report is the brief. **Exception:** if the fix needs a Core or Contract change, pause for a Plan Gate.

1. `aico:qa`: reproduce the bug, write a failing regression test, and name the suspected Module. Then tier-set.mjs begin (tier-path.md step 5).
2. The engineer who owns that Module (backend/frontend/desktop/ai-data/game): root cause via `aico:debugging`, fix via `aico:tdd`. After its commit, tier-set.mjs sync --diff (tier-path.md step 8).
3. `aico:code-reviewer` ∥ `aico:qa` (re-run the regression test and the affected test files only, no full suite) ∥ `aico:security` (if the bug touches auth, input handling or data, when `lanes.security` is on (`aico:pipeline` §1.7) and security is in the tier set), with Fix rounds per `aico:pipeline`.
   - `aico:fresh-reviewer` (set entry `second-reviewer`) beside the Code Reviewer, only at Risk tier `high` with `pipeline.second_reviewer` `on` and the entry in the set (`aico:pipeline` references/review-loop.md).
   **→ Ship Gate** (after sync --diff; added lanes first)
4. `aico:devops` if a release is needed.
