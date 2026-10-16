# aico — McSparrow AI company plugin: spec

Vocabulary: see `GLOSSARY.md`. Decisions: `docs/adr/`.

## Shape
- Claude Code plugin named `aico`. Roles = subagents (`agents/`). Practices, the Lead and Playbooks = skills (`skills/`).
- Subagents cannot spawn subagents, so the **Lead runs in the main session as a skill** (`/aico:lead`) carrying the Project Manager persona and dispatching Role subagents.
- Entry points: `/aico:lead` (routes any request), Playbooks `/aico:feature`, `/aico:fix`, `/aico:launch`, `/aico:audit`, `/aico:client`, `/aico:usability-test`, or any Role directly. Lead and Playbooks share the `pipeline` Practice; they never call each other.

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
| Product Manager | product-manager | sonnet | read-only + Write |
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
| Marketer | marketer | haiku | full |
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

"read-only + Write" = Read, Grep, Glob, Skill, Write; Write is for its Handoff only. Exceptions: the Architect also writes ADRs and Contract definition files (interfaces/schemas, no implementation); Code Reviewer, Security and Legal also have Bash for read-only commands (git diff, audits).
"full" = Read, Grep, Glob, Skill, Write, Edit, Bash.

## Practices (skills)
Own: `handoff`, `pipeline`, `contracts`, `stack-detect`, `art-direction`, `usability`.
Pointers (name the installed skill + 2–3 line fallback): `tdd`, `review`, `security-check`, `ui-design`, `debugging`, `writing`, `planning`, `verify`.
Stack packs: none shipped; `stack-detect` maps manifests (Cargo.toml, go.mod, package.json, composer.json, *.csproj, pyproject.toml) to installed skills; packs are added under `skills/stack-detect/references/` only when a gap appears.

## Context files
- `company/PROFILE.md` (in plugin): McSparrow; Voice presets clear / bold / technical; jurisdiction Netherlands/EU (GDPR); default license proprietary.
- `.company/project.md` (per product repo, created by Lead/Playbook on first run from template): product type (web|desktop), own|client, audience, stack, voice preset, license, client name, approved Core list.

## Budgets (guideline, warn not fail)
Agent files ≤ 50 lines, skill files ≤ 125 lines, description ≤ 1024 chars (hard). `scripts/check.mjs` reports every structural overrun.

## Verification
`node --test` for the checker; pressure tests per `superpowers:writing-skills` (RED baseline without skill, GREEN with) for the discipline-critical skills.
