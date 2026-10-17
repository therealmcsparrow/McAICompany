# aico — McSparrow AI company plugin: spec

Vocabulary: see `GLOSSARY.md`. Decisions: `docs/adr/`.

## Shape
- Claude Code plugin named `aico`. Roles = subagents (`agents/`). Practices, the Lead and Playbooks = skills (`skills/`).
- Subagents cannot spawn subagents, so the **Lead runs in the main session as a skill** (`/aico:lead`) carrying the Project Manager persona and dispatching Role subagents.
- Entry points: `/aico:lead` (routes any request), Playbooks `/aico:feature`, `/aico:fix`, `/aico:launch`, `/aico:audit`, `/aico:client`, `/aico:usability-test`, `/aico:feedback`, `/aico:incident`, `/aico:refactor`, `/aico:maintain`, or any Role directly. Lead and Playbooks share the `pipeline` Practice; they never call each other.

## Run mechanics
- Every Step = one Role subagent with fresh context. It reads only the Handoff files it is given plus the relevant section of `.company/project.md`, and writes exactly one Handoff: `.company/work/<task-slug>/NN-<role>.md`.
- Gates (CEO approval): **Brief**, **Plan**, **Ship**. Nothing between them asks the CEO.
- Fix rounds: only blocking issues loop back to the builder; max 2 per piece of work, then escalate to CEO. Nits are recorded only.
- Git: one branch per run (`aico/<task-slug>`, worktree if available), one commit per Step including its Handoff, no push/merge before Ship Gate.

## Architecture rule (all product types)
- Core + Modules + Contracts (ADR 0002). Architect proposes Core list and Contracts; CEO approves at Plan Gate. Additive Contract changes: Architect. Breaking: new version + CEO.
- Code Reviewer: blocking if a Module touches another Module's internals, Core gains unapproved code, or a Contract is broken. QA writes contract tests per Module.

## Roster (agents)
| Role | file | model | tools |
|---|---|---|---|
| Product Manager | product-manager | opus | read-only + Write |
| Account Manager | account-manager | sonnet | read-only + Write |
| Architect | architect | opus | read-only + Write |
| Legal/Compliance | legal | sonnet | read-only + Write |
| Backend Engineer | backend-engineer | sonnet | full |
| Frontend Engineer | frontend-engineer | sonnet | full |
| Desktop Engineer | desktop-engineer | sonnet | full |
| AI/Data Engineer | ai-data-engineer | sonnet | full |
| DevOps/Release | devops | sonnet | full |
| UI/UX Designer | ui-ux-designer | sonnet | full |
| Writer | writer | haiku | full |
| Marketer | marketer | sonnet | full |
| Code Reviewer | code-reviewer | opus | read-only + Write |
| QA Tester | qa | sonnet | read + Bash + Write (tests & handoff only) |
| Security Engineer | security | opus | read-only + Bash + Write |
| Brand Artist | brand-artist | sonnet | full |
| Prompt Artist | prompt-artist | haiku | read-only + Write |
| Motion Artist | motion-artist | sonnet | full |
| Game/3D Artist | game-artist | sonnet | full |
| Persona Tester | persona-tester | sonnet | read-only + Write |
| Hands-on Tester | hands-on-tester | sonnet | inherits all (browser/computer-use); never edits |
| Accessibility Tester | accessibility-tester | sonnet | inherits all; never edits |
| UX Researcher | ux-researcher | sonnet | read-only + Write |
| Support | support | sonnet | read-only + Write |
| Localizer | localizer | haiku | full |
| Game Engineer | game-engineer | sonnet | full |

"read-only + Write" = Read, Grep, Glob, Skill, Write; Write is for its Handoff only. Exceptions: the Architect also writes ADRs and Contract definition files (interfaces/schemas, no implementation); Code Reviewer, Security and Legal also have Bash for read-only commands (git diff, audits).
"full" = Read, Grep, Glob, Skill, Write, Edit, Bash.

## Practices (skills)
Own: `handoff`, `pipeline`, `contracts`, `stack-detect`, `art-direction`, `usability`, `eu-compliance`, `performance`, `i18n`, `observability`.
Pointers (name the installed skill + 2–3 line fallback): `tdd`, `review`, `security-check`, `ui-design`, `debugging`, `writing`, `planning`, `verify`.
Stack packs: none shipped; `stack-detect` maps manifests (Cargo.toml, go.mod, package.json, composer.json, *.csproj, pyproject.toml) to installed skills; packs are added under `skills/stack-detect/references/` only when a gap appears.

## Context files
- `company/PROFILE.md` (in plugin): McSparrow; Voice presets clear / bold / technical; jurisdiction Netherlands/EU (GDPR); default license proprietary.
- `.company/project.md` (per product repo, created by Lead/Playbook on first run from template): product type (web|desktop|game), own|client, audience, stack, voice preset, license, client name, languages, performance budgets, approved Core list.
- `.company/lessons.md` (per product repo): one line per lesson from each run's retro; the Lead reads it at Setup and passes relevant lines in dispatch Goals.

## v0.3 additions
- **Post-ship loop:** `/aico:feedback <reports>` — support triages, de-duplicates and clusters user reports, then the Lead proposes `/aico:fix` / `/aico:feature` runs at a Gate. `/aico:incident <what>` — devops triages and mitigates, owner engineer fixes via the fix route, legal checks CRA reporting (actively exploited vulnerability or severe incident → ENISA early warning within 24h), devops writes the postmortem.
- **Refactor:** `/aico:refactor <scope>` — moves existing code toward Core + Modules + Contracts one slice at a time; QA writes characterization tests before any change; a Plan Gate per slice.
- **Maintain:** `/aico:maintain` — dependency upgrades, security patches, license re-check, SBOM refresh; read-only report first, then fixes after a Gate; schedulable.
- **Spike:** when the Architect lists a risk under `## Spikes`, the Lead may dispatch the owning engineer for a throwaway proof in `.company/work/<slug>/spike/` (never merged into the product); its result goes to the Plan Gate.
- **Fix Playbook:** step 3 runs `qa` ∥ `code-reviewer` (∥ `security`) so the full suite is re-run.
- **Retro and estimates:** pipeline Finish adds per Module: estimate (S/M/L), Steps used, Fix rounds; and appends up to 3 lessons to `.company/lessons.md`.
- **EU law** (`eu-compliance` Practice, used by legal, security, ai-data-engineer): GDPR, CRA (SBOM, vulnerability handling, ENISA reporting from 11 Sep 2026, full obligations 11 Dec 2027), AI Act Art. 50 transparency, European Accessibility Act, EU VAT/OSS and the 14-day withdrawal right for digital sales.
- **Pricing:** product-manager owns plans and pricing in the brief; billing is a Module the Architect plans; legal checks VAT and consumer law.
- **Game product type:** game-engineer builds on the detected engine (Phaser/Three.js, Bevy, Unity, Godot, Unreal); game-artist owns the Blender asset pipeline (`.blend` → glTF/FBX).
- **Performance:** `performance` Practice (budgets in `.company/project.md`) loaded by qa and code-reviewer; a 5th lane in `/aico:audit` (qa runs it).
- **Observability:** devops adds logs, metrics, health checks and alerts per Module (`observability` Practice).

## Budgets (guideline, warn not fail)
Agent files ≤ 50 lines, skill files ≤ 125 lines, description ≤ 1024 chars (hard). `scripts/check.mjs` reports every structural overrun.

## Verification
`node --test` for the checker; pressure tests per `superpowers:writing-skills` (RED baseline without skill, GREEN with) for the discipline-critical skills.
