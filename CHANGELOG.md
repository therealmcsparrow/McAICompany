# Changelog

All notable changes to the aico plugin. Versions follow the plugin's own releases.

## [0.8.1] - 2026-10-22

### Fixed
- **The cooler chat reads like a movie script.** A `# THE WATER COOLER` title and logline, `### SCENE n — INT. OFFICE KITCHEN, BY THE WATER COOLER — NIGHT` headings (later `SAME — CONTINUOUS`, `MOMENTS LATER`, …) split by subject with `---`, an italic action line per scene, capitalised speaker cues with the line as a quote and optional `*(parentheticals)*`, walk-ups, walk-offs and passes as action lines, and `**FADE OUT.**` at the end. Every element is its own block, so Markdown no longer runs the chat into one paragraph.
- **Overheard is saved in the file, not shown on screen.** One bullet per idea, problem, worry or question, with who raised it. The terminal gets only the file path, the number of turns and who was there.

## [0.8.0] - 2026-10-22

### Added
- **`/aico:cooler [topic] [turns=N | listen]`** — an unmoderated water-cooler chat. 2–3 random Roles talk about the project (the topic, or something on their mind), one line at a time; random colleagues walk up and others leave (2–5 at the cooler). Ends when everyone passes or at 20 turns (default), after N turns, or when the CEO stops it in `listen` mode, where the CEO can also chime in. Recorded in `.company/cooler/YYYYMMDD-HHMM-<topic>.md` with an "Overheard" list at the top; nothing is built or routed. `/aico:brainstorm` accepts a cooler file as its idea.
- **`/aico:help [command]`** — lists every command, or explains one: usage, each option and its effect, what it does, what you get. Every command also takes `help` / `--help` (e.g. `/aico:feature help`) to show the same.
- **`/aico:version`** — shows the installed plugin version (from `plugin.json`) with its latest changelog entry. Read-only.

### Changed
- **Every command takes `help`.** A lone `help` or `--help` argument on any Playbook shows its `/aico:help` entry and runs nothing.
- **`/aico:brainstorm`** accepts a `.company/cooler/` file; its Overheard list becomes the idea.
- **`/aico:lead`** routes "let colleagues chat informally about the project" to `/aico:cooler`.
- **Docs:** `/aico:cooler`, `/aico:help` and `/aico:version` in the README table, the command guide (the Setup section is now "Setup and help"), getting started, concepts (`.company/cooler/`), the Glossary (Cooler) and the spec (v0.8).

## [0.7.3] - 2026-10-21

### Changed
- **Every ask to the CEO is a form.** Gates, `needs-ceo` questions, picks from audit/pentest/vulnscan/feedback/usability reports, escalations, brainstorm rounds and setup approval all go through AskUserQuestion; the Lead's text reply carries summaries and paths only and never ends with a question (`aico:pipeline`).

## [0.7.2] - 2026-10-21

### Changed
- **Code comments are about the code only.** No Handoff, Step, Role, AI or company notes in product code, tests or config; they stay in `.company/` (`aico:tdd`, `aico:handoff`). The Code Reviewer blocks such a comment as `spec` (`aico:review`).

## [0.7.1] - 2026-10-21

### Added
- **Context budget** — no agent may go over 150k tokens of context. A Role near the budget stops at a clean point and writes a Handoff with the new `status: handover`; the Lead dispatches a fresh Step of the same Role to continue from its `## Next` (no Fix round consumed). The Lead hands itself over via `00-lead-state.md` and a fresh session (`aico:handoff`, `aico:pipeline`).

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
