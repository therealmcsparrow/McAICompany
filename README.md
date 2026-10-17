# aico: the McSparrow AI company

A Claude Code plugin that runs a small software company. You are the **CEO**. A **Lead** (Project Manager) routes work to 26 **Role** agents. Each Role starts with a fresh context and passes its work on through **Handoff** files. You approve at three **Gates**: Brief, Plan and Ship. Terms are defined in `GLOSSARY.md`; decisions are in `docs/adr/`.

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
| `/aico:feedback <source>` | Turns user feedback, reviews and support reports into ranked fix and feature proposals you pick from |
| `/aico:incident <what broke>` | Mitigate, check EU reporting duties, fix, then write the postmortem. Urgency allowed; the Ship Gate stays |
| `/aico:refactor <scope>` | Restructures existing code toward Core, Modules and Contracts in safe slices, no behavior change |
| `/aico:maintain` | Routine upkeep: dependencies, vulnerabilities, licenses and CI health, then the upgrades you pick |

You can also ask for any Role directly, e.g. "use the aico security agent on src/auth".

## Roles
| Opus | Sonnet | Haiku |
|---|---|---|
| architect, code-reviewer, security, product-manager | account-manager, marketer, support, legal, backend-, frontend-, desktop-, game-, ai-data-engineer, devops, ui-ux-designer, qa, brand-, motion-, game-artist, persona-, hands-on-, accessibility-tester, ux-researcher | writer, localizer, prompt-artist |

Code-reviewer, security, legal, PM, account manager and support never edit source. The localizer edits only string resource files. The architect writes only ADRs and Contract definitions (interfaces/schemas). QA edits tests only. Testers never edit; hands-on- and accessibility-tester use your browser/computer-use tools.

## Rules everything follows
- **Core + Modules + Contracts** for every product: backend, frontend, desktop and game. Only CEO-approved items go in Core (`skills/contracts`).
- **Fix rounds:** at most 2, then escalation to you. Nits never loop.
- **Lessons:** a Ship appends up to 3 one-line Lessons to `.company/lessons.md`; later runs read it and pass the relevant ones to each Role.
- **EU compliance** (`aico:eu-compliance`): GDPR, CRA, AI Act Art. 50, EAA, VAT and consumer law are checked before Ship.
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
