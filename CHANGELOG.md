# Changelog

All notable changes to the aico plugin. Versions follow the plugin's own releases.

## [Unreleased]

Cheaper brainstorms and cheaper runs. The savings come from reading less (shorter prompts, fewer reads, fewer dispatches). Brainstorm Roles now keep one constant prompt, so it can be cached. No saving percentage is claimed yet.

### Added
- **Mods.** Four add-ons inside Claude Code, all on by default and switched in `/aico:settings` (Mods section); see `documentation/mods.md`. **Savvy** shows run progress. **Cache Tax** shows spend per Step and the cache clock: when the Lead's cache expires, with a note that subagent caches last 5 minutes. **Reflect** checks each Step and the finished run and suggests Lessons; each needs your Accept, and `model` mode (off by default, user level only) spends tokens that are ledgered as `reflect`. **Blast Radius** checks a `git commit` before it runs, through both the `Bash` and `PowerShell` tools: `core: ask`, `security: ask`, `contract: warn` by default; with nobody to ask (plain `claude -p`) it refuses the commit with a reason. The mods share one status line. Terminal is proven; desktop is unverified and shows `unknown` where scripts cannot run.
- **Run-state** (`scripts/run-state.mjs`): the Lead records each run's wave, Gates and end. It never blocks a Step or a Gate.
- **Mod settings** (`mods.*`) with three locks: Reflect `model` is user-level only; a project can only tighten Blast Radius; `security: warn` and switching Blast Radius off need the `security` unlock. There is no keep-warm key.
- **Contracts:** `aico-mods` v1, `run-state` v1, `reflect` v1, `lessons` v1; additive changes to `token-ledger`, `review-depth` and `aico-settings`. ADRs 0015 to 0017.
- **Brainstorm format 2.** New files have `## Summary`, `## Digest`, `## Questions` and `## Rounds`. The digest quotes your answers word for word, lists open threads and keeps a dissent line in the Role's own words. Questions are queued: duplicates merged with votes summed, answered ones never asked again, blocking first. A skipped question records its default as "CEO skipped". Roles can reply to an idea (`@Role on I-2.1: agree | challenge | build-on`), may skip a round, and answer in about 100 words. Each Role gets one constant dispatch prompt for the whole run plus a per-round input file in `.company/brainstorm-input/` (written by the script, removed at Close) with the digest, the questions already asked and answered, and up to five "Others said" headlines with idea IDs. Answered questions are merged, not asked again. The Architect adds an S/M/L estimate per round. Files without `format` open and continue as before and are never rewritten.
- **Crossfire.** In debate mode the sharpest clash is folded into the next round: the challenged Role answers it in its next ideas pass, with no extra dispatch. `brainstorm.debate` is `crossfire` (default) or `full_pass`, which keeps the live pair and the full second pass.
- **Shorter brainstorm replies and input files.** The Lead asks for at most 80, 55 and 40 words (ideas, full, crossfire). The input file drops the digest and shows "Your last ideas" as plain lines without IDs or labels. A reply with a copied idea ID or bullet before a label is accepted, not re-asked.
- **Builder rule slices.** Builders get a per-task file with their rules in `.company/work/<slug>/rules/<task>.md` (`rule-check slices --write`) instead of the full ruleset map.
- **CEO rulings without a question.** A ruling that answers no asked question is stored word for word as its own decision (`decide`), no longer attached to a nearby question. A brainstorm Lead summary that says `Open:` must name a question or open thread, or say `Open: none`.
- **Review Handoffs.** A `read_next` pointer may be `path#heading` with spaces in the heading, and a continued review appends its new findings to the findings file.
- **Film script** (`brainstorm.film_script`, off by default): a separate file written by the script with no model call, every line quoting a stored reply.
- **Max context** (`context_cap`) in `/aico:settings`: global plus per Role, default 150000, minimum 60000. Roles hand over at 80%. High-risk work is never below the default.
- **Token ledger** (`scripts/ledger.mjs`): counts only, per Step and per run, in `.company/ledger/`. One cost line at the Ship Gate; `/aico:feedback` compares the last three runs.
- **Review format** (`pipeline.review_format`: `plain` or `pilot`, default `plain`) in `/aico:settings`. With `pilot`, the code-reviewer and compliance Steps write an `aico-top` block, findings as `ID | file:line | problem | why | fix` rows with stable IDs, and a findings ledger on handover, checked by `scripts/handoff-lint.mjs`. Other Roles are unchanged. Tested on 3 re-reviews each way, both modes pass; `pilot` cost about 5.7k more tokens per re-review than `plain`, and no saving is claimed. Rule slices for builders and search-then-read stay on with `plain`.
- **Tool checks bound by rule ID** (`scripts/rule-check.mjs`, `.company/checks.json`): a failing check becomes a finding the reviewer confirms before it blocks. Rule slices always include every security Must. With `pipeline.review_format: pilot`, a findings ledger, written only near a handover, survives a handover mid-review. Review depth follows the touched paths (`scripts/review-depth.mjs`).
- **Golden Handoffs and a regression set** of past high-tier fixes, both under `npm test`.
- **`npm run release <x.y.z>`**: bumps every version field, rolls this section, runs the checks, makes one local commit and tag. It never pushes.
- **Rule-pack checks** in `scripts/check.mjs --packs <dir>`: a bad format, a pack older than 90 days or a new advisory fails. CI on committed copies fails at 180 days.
- **Contracts:** `handoff` v1.1, `dispatch-prompt` v3.1 (`Context cap:`, `Review depth:`), `aico-settings` v1.1, `brainstorm-file` v2, `brainstorm-reply` v1, `token-ledger` v1, `rule-pack` v1.1, `rule-check` v1, `review-depth` v1. ADRs 0007 to 0012.

### Changed
- **Pipeline dispatches** carry `Context cap:` and, for the code-reviewer, `Review depth:`. `scripts/check.mjs` fails a dispatch block without `Context cap:`. No Playbook is exempt: research prompts carry it too; only brainstorm and cooler, which write no Handoff, have no such line.
- The commit lines in the pipeline and brainstorm Playbooks check paths and names before any shell command.

## [0.10.0] - 2026-10-26

A settings page, a name for every Role, and an effort level per Role. The pipeline now applies your settings when it dispatches.

After updating, run `/reload-plugins`. Settings are optional: nothing changes until you save something.

### Added
- **`/aico:settings`** — opens a local page (a small server on 127.0.0.1, protected by a token in the link) to set each Role's name, model and effort; language and profile; the pipeline (Fix-round limit, parallel or sequential dispatch, optional lanes); and the Gates (ask or auto). Set it as your default (`~/.mcsparrow/config.json`) or as a project override (`.company/settings.json`); the project wins. Ship, installs and the security lanes can only be unlocked from your default. The page stops when you press Done, or after 30 minutes idle. `node scripts/settings.mjs get <key>` prints a resolved value.
- **Role names.** Every Role has a person name (`company/names.json`, for example Ava for the architect), which you can change per level in the settings page.
- **Contracts and decision:** `aico-settings` v1, `role-names` v1 and ADR 0006 (settings resolve in a script and travel in the dispatch).

### Changed
- **The pipeline reads settings.** Setup resolves them once per run; each dispatch passes `model` and `effort` to the Role and carries `Name:` and `Settings:` lines (`dispatch-prompt` v3). Gates, Fix rounds, dispatch mode and optional lanes follow your settings. With nothing set, behaviour is as before.
- **Names are shown.** Scripts, the cooler and brainstorm, Handoffs, Gates and `/aico:help` show a Role's name with the Role. The Lead routes by name only when the name is used as a person.
- Every Role now sets an `effort` level. **High:** architect, code-reviewer, security, pentester. **Low:** writing, art, lookup and support Roles. **Medium:** the rest. `scripts/check.mjs` fails an agent with no `effort` or an invalid one.
- Model changes: writer haiku → sonnet, because user-facing docs need it. vuln-scanner and design-researcher opus → sonnet, because their work is lookup against fixed checklists.

## [0.9.0] - 2026-10-22

Research before you build: three researcher Roles look a topic up online before work starts, and the Product Manager turns the findings into one sourced report. Also a language setting for aico's own output.

After updating, run `/aico:setup` (it installs the `research` skill group) and `/reload-plugins`.

### Added
- **`/aico:research <topic | project | file> [quick|deep]`** — a read-only Playbook. One form approves the research question, the depth (default deep) and the Roles. The researchers search in parallel, and the Product Manager writes one report: `## Verdict` (go, go-with-conditions or no-go, with confidence), `## What to do` (ranked), `## Low-hanging fruit` (impact and effort), `## Risks`, `## Open questions` and `## Sources`. Every claim cites a source with its URL and check date. A claim without a source is marked `unverified` and cannot back the verdict. The report goes to `.company/research/YYYY-MM-DD HH.MM - <Topic>.md`, labelled AI-generated research. Then you pick: start `/aico:feature`, brainstorm, roadmap or park. Only the report is committed, and nothing is pushed.
- **Three Roles:** `market-researcher` (demand, competitors, target users, pricing signals, EU flags for legal), `tech-researcher` (feasibility, libraries and APIs, licenses, fit with the repo, effort and risk; it reports facts and never picks the stack) and `design-researcher` (finds and vets UI/UX skills against your stack, Personas and Art direction; recommends at most 5). Researchers write only their own Handoff and never install anything.
- **Design skills.** `## Design skills` in `.company/project.md` records the approved set: name, source, license, vetted and approved dates. `/aico:feature` runs the design-researcher for a UI product when the set is empty or older than 180 days. Installs run only after you approve the exact commands in a form.
- **`/aico:language [<tag> [project] | clear [project]]`** — the language aico writes in: Handoff prose, forms, reports, summaries and commit summaries. Your default is stored in `config.json` under `~/.mcsparrow/` (or `MCSPARROW_HOME`). A project override is the `aico_language:` line in `.company/project.md`. With neither set, aico writes English, as before. Machine-read parts stay English in every language: frontmatter, headings, status values, blocking tags, file and folder names, commit types.
- **`research` skill group** in `deps/skills.json`: `find-skills` (MIT), included in `core`. aico uses it for guidance only; the search itself uses WebSearch and WebFetch.
- **Checks in `scripts/check.mjs`:** the Role count in the plugin description and docs, every agent listed in `documentation/roles.md` and the spec roster, a `/aico:<name>` entry in `documentation/commands.md` for every Playbook, `Language:` in every dispatch block, and the name and source patterns of skill manifest entries.

### Changed
- **Roles: 29 to 32.** The three researchers join the company. The hierarchy has a "Market & tech research" department, separate from "User research & testing".
- **Dispatches carry `Language:`.** The pipeline resolves the language once per run and passes it to every Role, including the Playbooks that skip pipeline setup (brainstorm, cooler, research, triage, help).
- **`/aico:brainstorm`** accepts a research report. Its close form gains "Research it first".
- **`/aico:lead` and `/aico:triage`** route research, feasibility and quick-win questions to `/aico:research`.
- **Five UI Roles** (ui-ux-designer, frontend-engineer, desktop-engineer, game-engineer, brand-artist) load the approved design skills from their dispatch. A skill that is not installed is named under `## Next`.
- **Development:** `npm test` runs every `scripts/*.test.mjs`. The repo targets Node 24 (`.nvmrc`, `engines`). CI runs with read-only token permissions and pinned action commits. Skill installs need Node 22.20 or later. Text files are stored with LF line endings (`.gitattributes`).

### Fixed
- **Report names are checked before use.** A topic with anything but letters, digits, single spaces or hyphens, or longer than 5 words or 60 characters, is not used. The report is named with the run slug instead, and the commit is made only from the checked name.
- **Presence check stops cleanly on error.** If the install check fails, `/aico:research` shows the error, installs nothing, asks no form and continues on WebSearch and WebFetch.
- **Design-skill dates use your local day.** Dates in `## Design skills` are checked against the local calendar, not UTC, so today is accepted and tomorrow refused in every time zone.
- **Plugin script paths are quoted.** Commands run `node "${CLAUDE_PLUGIN_ROOT}/scripts/…"`, so they work when the install path contains spaces. Skill installs off Windows run `npx` without a shell.

### Rollback
A design-skill install in a product adds `.agents/skills/`, `.claude/skills/<name>` and `skills-lock.json` in that product's repo. To remove a skill, run `npx -y skills@1.7.4 remove <name> -a claude-code` in the product root, then delete its line under `## Design skills`. impeccable uses its own installer, and its uninstall path is not verified.

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
