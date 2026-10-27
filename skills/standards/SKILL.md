---
name: standards
description: Playbook. Research or refresh the ruleset: sourced best-practice rules per tool, security as law.
disable-model-invocation: true
argument-hint: [tool | refresh]
---

# Playbook: standards

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `standards` and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook standards` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`; no Brief or Plan Gate, the Ship Gate stays. Rules per `aico:ruleset`.

1. `aico:senior-engineer`:
   - `<tool>` → mode **research** for it. `refresh` or nothing → mode **refresh**: the CEO picks from its report in a `multiSelect` form, then **research** those.
   - In `research` and `map`, `rule-check.mjs slices <Handoff> --write` runs before `done`.
2. `aico:architect`: ruleset sign-off, only when Must rules were added or changed. One rejection → one revision; still rejected → the CEO decides. Then `rule-check.mjs drift`; exit 1 → rebind the check or restore the rule.
3. Exception requests and new `## Debt` go to the CEO in one form; offer `/aico:fix` or `/aico:refactor` runs, never start them.
   **→ Ship Gate** (merge the ruleset change)

Never commit `~/.mcsparrow/standards/`; report its changes.
