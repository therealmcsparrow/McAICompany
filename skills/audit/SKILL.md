---
name: audit
description: Playbook. Assess an existing codebase for quality, tests, security, licenses and architecture, and produce one prioritized report. Changes no code.
disable-model-invocation: true
argument-hint: [path or scope]
---

# Playbook: audit

Run with `aico:pipeline`, but **read-only**: no branch commits except Handoffs, and no builders. No Gates until the report is ready.

1. In parallel (lane 6 `aico:senior-engineer`, compliance of the whole codebase, only when `.company/standards.md` exists; its findings are Debt, not Blocking): `aico:code-reviewer` (quality and Core/Module/Contract conformance), `aico:qa` (test coverage and gaps; run the existing suite; also measures against the Performance budget, `aico:performance`), `aico:security` (vulnerabilities, dependency audit), `aico:legal` (dependency licenses vs the project license, GDPR exposure; runs the `aico:eu-compliance` scope check).
2. You (the Lead) merge the lane Handoffs into `.company/work/<slug>/report.md`:
   - Critical / Important / Minor, each with file:line, owner Role and fix size (S/M/L)
   - Performance: results against the budget
   - Ruleset: Must violations by rule ID (Debt), stale packs
   - Architecture: how far the code is from Core + Modules + Contracts
   - Top 5 recommended next actions
3. Present the report to the CEO and offer to start `aico:fix` or `aico:feature` runs for chosen items.
