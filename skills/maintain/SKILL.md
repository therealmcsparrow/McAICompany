---
name: maintain
description: Playbook. Routine upkeep. Check dependencies, vulnerabilities, licenses and CI health, then apply the upgrades the CEO picks.
disable-model-invocation: true
argument-hint: (no arguments)
---

# Playbook: maintain

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `maintain` and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook maintain` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`. No Plan Gate. If an upgrade changes a Contract or Core, pause for one. Read-only first: no builders until the CEO picks.

1. In parallel: `aico:security` (dependency vulnerabilities, flag exploited ones: stop and suggest `/aico:incident`), `aico:legal` (license re-check), `aico:devops` (outdated dependencies, report SBOM status, CI health), `aico:senior-engineer` (refresh: stale packs, changed guidance, deprecations, advisories).
2. You (the Lead) merge the Handoffs into `.company/work/<slug>/maintenance-report.md`: Critical / Important / Minor, each with owner and size.
   **→ Brief Gate** (the CEO picks upgrades in a form, `multiSelect`)
3. Rule changes the CEO picked: `aico:senior-engineer` (research), then `aico:architect` sign-off if Must rules changed. Then the owning engineer per upgrade group (one Step per group), then `aico:code-reviewer` ∥ `aico:qa` ∥ `aico:security` ∥ `aico:senior-engineer` (compliance) when `lanes.compliance` is on (`aico:pipeline` §1.7).
   **→ Ship Gate**

Finish by noting: "Schedulable with `/schedule` (e.g. monthly)". Follow-up runs are proposed to the CEO, never started by the Lead.
