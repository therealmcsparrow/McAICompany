---
name: standards
description: Playbook. Research or refresh the product's ruleset - sourced best-practice rules per tool, with security as law.
disable-model-invocation: true
argument-hint: [tool | refresh]
---

# Playbook: standards

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `standards` and stop.

Run with `aico:pipeline`. No Brief or Plan Gate (this Playbook's own skip); the Ship Gate stays. Rules work per `aico:ruleset`.

1. `aico:senior-engineer`:
   - `<tool>` given → mode **research** for that tool.
   - `refresh` or nothing → mode **refresh**. Show its report to the CEO, ask in a form (`multiSelect`) which changes to take, then dispatch **research** for those.
2. `aico:architect`: ruleset sign-off, only when Must rules were added or changed. One rejection → one Senior Engineer revision; still rejected → the CEO decides.
   After sign-off the Lead runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/rule-check.mjs" drift`. Exit 1 → back to the Senior Engineer: rebind the check or restore the rule text. A changed rule that has a `check:` tag keeps its binding in `.company/checks.json`.
   `research` and `map` modes: every `## Rules per task` row carries all security Musts (`aico:ruleset` slices).
3. Exception requests and new `## Debt` lines go to the CEO in one form. Offer `/aico:fix` or `/aico:refactor` runs for Debt; never start them.
   **→ Ship Gate** (merge the `.company/standards.md` and `.company/standards/` change)

Library files under `~/.mcsparrow/standards/` are never committed by the run; tell the CEO which ones changed.
