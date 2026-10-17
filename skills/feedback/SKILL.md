---
name: feedback
description: Playbook. Turn user feedback, reviews and support reports into ranked fix and feature proposals the CEO picks from.
disable-model-invocation: true
argument-hint: <reports: path, paste or export>
---

# Playbook: feedback

Run with `aico:pipeline`. No Plan or Ship Gate: nothing is built or shipped. Read-only: no builders.

1. `aico:support`: triage the reports into clusters in `.company/work/<slug>/feedback-report.md`. If a cluster looks security-related, stop and suggest `/aico:incident` to the CEO.
2. `aico:product-manager`: read the clusters and the success metric in `.company/project.md`, rank the top 5, and propose a fix or feature for each.
   **→ Brief Gate** (the CEO picks)
3. You (the Lead) tell the CEO which `/aico:fix` and `/aico:feature` runs to start. Never start them yourself.
