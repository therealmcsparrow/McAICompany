# aico: the McSparrow AI company

A Claude Code plugin that runs a small software company. You are the **CEO**. A **Lead** (Project Manager) routes work to 23 **Role** agents. Each Role starts with a fresh context and passes its work on through **Handoff** files. You approve at three **Gates**: Brief, Plan and Ship. Terms are defined in `GLOSSARY.md`; decisions are in `docs/adr/`.

## Install
```
/plugin marketplace add Z:\projects\aicompany
/plugin install aico@aico
/aico:setup                 # standalone skills: hallmark, find-skills, humanizer, impeccable, …
/aico:setup go react        # optional stack groups: go, react, tanstack, auth
```
`superpowers` and `mattpocock-skills` install automatically as plugin dependencies.

## Use
| Command | What it does |
|---|---|
| `/aico:lead <request>` | Front door. Picks the Roles and the route, then runs it |
| `/aico:feature <desc>` | Brief → Plan (Core + Contracts) → build per Module → review, QA, security → Ship |
| `/aico:fix <bug>` | QA reproduces → engineer fixes test-first → review → Ship |
| `/aico:launch <product>` | Positioning, copy, release notes, privacy/terms → Ship |
| `/aico:audit [scope]` | Read-only quality, test, security and license report |
| `/aico:client intake\|handoff` | Client brief, estimate and proposal, or the client handoff package |
| `/aico:usability-test <target> [real-users]` | Every Persona tests in parallel (walkthrough, hands-on, accessibility) → one report |

You can also ask for any Role directly, e.g. "use the aico security agent on src/auth".

## Roles
| Opus | Sonnet | Haiku |
|---|---|---|
| architect, code-reviewer, security | product-manager, account-manager, legal, backend-, frontend-, desktop-, ai-data-engineer, devops, ui-ux-designer, qa, brand-, motion-, game-artist, persona-, hands-on-, accessibility-tester, ux-researcher | writer, marketer, prompt-artist |

Code-reviewer, security, legal, PM and account manager never edit source. The architect writes only ADRs and Contract definitions (interfaces/schemas). QA edits tests only. Testers never edit; hands-on- and accessibility-tester use your browser/computer-use tools.

## Rules everything follows
- **Core + Modules + Contracts** for every product: backend, frontend and desktop. Only CEO-approved items go in Core (`skills/contracts`).
- **Fix rounds:** at most 2, then escalation to you. Nits never loop.
- **Git:** branch `aico/<task>`, one commit per Step, no push before the Ship Gate.
- **Per product repo:** `.company/project.md` (product type, stack, voice, license, approved Core) and `.company/work/<task>/NN-<role>.md` Handoffs.

## Customize
- Company facts and the three Voice presets (clear, bold, technical): `company/PROFILE.md`
- Missing stack skills: `find-skills`, then add a group to `deps/skills.json`. Stack packs go in `skills/stack-detect/references/` only when there's a real gap.

## Maintain
```
npm test        # checker and installer tests
npm run check   # frontmatter, broken aico: refs; warns when agents > 50 or skills > 125 lines
```
Pressure-test evidence: `tests/pressure/RESULTS.md`.
