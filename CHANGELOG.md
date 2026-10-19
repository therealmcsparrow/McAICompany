# Changelog

All notable changes to the aico plugin. Versions follow the plugin's own releases.

## [0.7.0] - 2026-10-20

Streamlining the company's own workflow (from the "faster, streamlined development" brainstorm). No new Roles — shared machinery instead.

### Added
- **Handoff Contract** — machine-readable Handoff frontmatter (`base-commit`, `risk-tier`, `acceptance-ids`, `files-touched`) and a `contract|spec|security|test` blocking taxonomy, so the Lead routes and resumes from fields, not prose (`aico:handoff`).
- **`/aico:triage`** — a pre-router Playbook: classify a request by size, risk and type and recommend the shortest valid route before the Brief Gate; risk always overrides size.
- **Plugin CI** (`.github/workflows/ci.yml`) running the checker and tests on every PR, and a **version-consistency check** in `scripts/check.mjs` (plugin.json vs CHANGELOG vs documentation).
- **Deterministic pre-filter** before the Code Reviewer: additive only — it appends findings, never closes a review, never consumes a Fix round.

### Changed
- **Parallel by default** in `aico:pipeline`: independent Roles and Modules are dispatched together; sequence only on real dependencies.
- **Diff-scoped review** from the dispatch's `base-commit`, never `HEAD~1` (`aico:review`, code-reviewer).
- **Risk-tiered testing** (QA): the Brief sets the tier (forced high for auth, payments, personal data, migrations, Contract changes); every acceptance criterion keeps its test; QA may raise a tier, never lower; the full suite still runs at the Ship Gate.
- **Warm rule packs** (`aico:ruleset`): a library pack is reused only if ≤90 days old with no new advisory since; kept-current stacks are JavaScript/Node, SQL (PostgreSQL/MySQL/MariaDB), React, Go, Rust, PHP, CSS, HTML.

## [0.6.0] - 2026-10-20
- On-demand **pentester** (`/aico:pentest`) and **vuln-scanner** (`/aico:vulnscan`) Quality & Security Roles. 29 Roles.

## [0.5.0] - 2026-10-19
- **`/aico:brainstorm`**: Roles weigh in on an idea over rounds until the CEO says done, then build / roadmap / nice-to-have / park.

## [0.4.0] - 2026-10-19
- **Senior Engineer** and the **Ruleset** (sourced Must/Should/May rules per tool, security as law) via **`/aico:standards`**.
