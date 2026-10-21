---
name: vulnscan
description: Playbook. On-demand scan of the product's dependencies and code against published vulnerability databases. Reports Critical/High for the CEO to pick, and a ready upgrade set for the rest. Changes no code.
disable-model-invocation: true
argument-hint: (no arguments)
---

# Playbook: vulnscan

Run with `aico:pipeline`, **read-only**: no builders, no code changes, no Gates until the report is ready. On demand only — not part of the default `/aico:feature`, `/aico:audit` or `/aico:maintain` flows.

1. `aico:vuln-scanner`: enumerate dependencies and versions (`aico:stack-detect`), cross-reference NVD/CVE, OSV, GitHub Advisories, the ecosystem DB, vendor advisories and CISA KEV. Output `.company/work/<slug>/vuln-report.md` with `## Report` (Critical/High, KEV/exploited) and `## Upgrade set` (safe Medium/Low fixed-in bumps).
2. You (the Lead) present it to the CEO and ask in one form (`aico:pipeline`):
   - A KEV-listed or actively-exploited hit is Blocking → suggest `/aico:incident`.
   - Other Critical/High → offer `/aico:fix` runs for the ones the CEO picks.
   - The `## Upgrade set` → offer one `/aico:maintain` run that applies those bumps.
   Never start a run yourself.

Dispatchable directly too ("use the aico vuln-scanner").
