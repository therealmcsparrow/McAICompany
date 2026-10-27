---
name: feedback
description: Playbook. Turn user feedback, reviews and support reports into ranked fix and feature proposals the CEO picks from.
disable-model-invocation: true
argument-hint: <reports: path, paste or export>
---

# Playbook: feedback

**Help:** argument is exactly `help` or `--help` → follow `aico:help` for `feedback` and stop.

**Type:** run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" check-playbook feedback` first; exit not 0 → show its output line and stop.

Run with `aico:pipeline`. No Plan or Ship Gate: nothing is built or shipped. Read-only: no builders.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/company-type.mjs" pick support account-manager product-manager`; the one slug it prints triages the reports into clusters in `.company/work/<slug>/feedback-report.md` (`pick` refused → show its line and stop). Run `check-role <slug>` before the dispatch. If a cluster looks security-related, stop and ask the CEO in a form whether to start `incident` (only when the `playbooks` type line lists it; else tell the CEO to handle it outside this run).
2. Cost numbers: for the last 3 runs in `.company/ledger/` (newest first) run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" report <run>` from the repo root. Keep two lines apart: **spend** (`in + cache_write + out`) and **cache read**, each per shipped AC. Never add them. A run with no ledger or `not reconciled` is named as such, never guessed. Put the lines in `feedback-report.md` under `## Cost`.
3. `aico:product-manager` (`check-role product-manager` first): read the clusters, the `## Cost` lines and the success metric in `.company/project.md`, rank the top 5, and propose a fix or feature for each.
   **→ Brief Gate** (the CEO picks in a form, `multiSelect`)
4. You (the Lead) tell the CEO which runs of the `work:` type line Playbooks to start (`fix` and `feature` for software). Never start them yourself.
