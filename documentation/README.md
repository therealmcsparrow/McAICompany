# aico documentation

**aico** is a Claude Code plugin that runs a small software company for you. You are the **CEO**: you ask for work and approve it at a few checkpoints. A **Lead** turns your request into a route and dispatches 35 specialist **Role** agents, who pass work to one another through files and never skip your approvals.

Start here:

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, your first run, how a job flows, and the three Gates where you approve |
| [Commands](commands.md) | Every `/aico:*` command (the Playbooks), what it does and when to reach for it |
| [Roles](roles.md) | All 35 Role agents, grouped by department, and what each one is for |
| [Mods](mods.md) | The four mods (Savvy, Cache Tax, Reflect, Blast Radius): what each shows, the shared status line, the cache clock, every `mods.*` setting and the three locks |
| [Concepts](concepts.md) | The ideas the company runs on: Handoffs, Gates, Core/Modules/Contracts, the Ruleset, Debt, Lessons, company types, personalities, settings and locks, EU compliance and Git conventions |

Reference material lives alongside these guides:

- [`../README.md`](../README.md) — the short project overview and the company hierarchy diagram
- [`../GLOSSARY.md`](../GLOSSARY.md) — one-line definitions of every term
- [`../docs/spec.md`](../docs/spec.md) — the full specification, version by version
- [`../docs/adr/`](../docs/adr/) — architecture decision records explaining why the company is built the way it is

> Everything the company produces for a given job lands under `.company/` in your product's repository — briefs, designs, code review notes, reports and the per-step Handoff files. You can read any of it; nothing is hidden.

## Version

**Current: 0.14.1** (35 Role agents).

Update an installed copy with:

```
/plugin marketplace update aico
/reload-plugins
```

### What's new

- **0.14.0** — A new Role, the reprompter (Lynn), and [`/aico:reprompt`](commands.md#aicoreprompt), which turns a rough prompt into a complete one and never runs it (files stay on your machine, and the prompt is AI-written, so check it).
- **Unreleased, company types and personalities** — Pick a [company type](concepts.md#company-types) for a project in [`/aico:setup`](commands.md#aicosetup): software (the default, as before), research consultancy, marketing and content agency, or design studio. Each type has its own Roles and Playbooks and its own meaning of "ship". New Playbooks: [`/aico:report`](commands.md#aicoreport), [`/aico:campaign`](commands.md#aicocampaign), [`/aico:content`](commands.md#aicocontent) and [`/aico:design`](commands.md#aicodesign). A new Role, the [editor](roles.md) (Edith), checks that every claim is cited. Every Role also gets a [personality](concepts.md#personalities), used only in cooler chats and brainstorms. The settings page has a new look and a Personality tab with a Role filter. The marketing and design checks record Legal's statement; they are not legal advice or a compliance certificate.
- **Unreleased** — A new Role, the skill-researcher (Selin), which finds and vets third-party skills (the Lead scans each pick, installs pin the scanned commit, and a bad scan after the install stops the run) and records approved ones under `## Skills` in `.company/project.md` (see [skill picks](concepts.md#skill-picks)); [`/aico:skillspector`](commands.md#aicoskillspector), which scans installed skills with SkillSpector (`--project`, `--global` or `--all`; pinned v2.13.1; the install changes your user-scope config and always asks; scan mode `no-llm` by default, set in `/aico:settings` under Skill scan; both modes send dependency names and versions to OSV.dev); and Gates and Steps bars in the [Savvy](mods.md#savvy) pane. Also: cheaper brainstorms (a [format 2](commands.md#aicobrainstorm) digest, a question queue, crossfire debate) and cheaper runs: a [max context](concepts.md#context-budget) setting, a counts-only [token ledger](concepts.md#token-cost) with a cost line at Ship, an opt-in Handoff v1.1 pilot (`pipeline.review_format: pilot`, default `plain`, about 5.7k more tokens per re-review), four [mods](mods.md) (Savvy run progress, Cache Tax with a cache clock, Reflect suggested Lessons, and a Blast Radius check before risky commits), tool checks bound to rule IDs, and a release script (`npm run release <x.y.z>`, never pushes). Savings come from reading less; brainstorm Roles keep one constant prompt per run. No saving percentage is claimed yet.

- **0.10.0** — [`/aico:settings`](commands.md#aicosettings): a local page to change each Role's name, model and effort, the language and profile, the Fix-round limit, review lanes and Gates. Settings are saved as a user default or per project. Risky changes are [locked](concepts.md#locks) until you unlock them in your user settings. Every Role now has a person name and an [effort level](concepts.md#models-effort-and-names).
- **0.9.0** — [`/aico:research`](commands.md#aicoresearch): before you build, three researchers look the topic up online and the Product Manager writes one sourced report with a verdict, ranked actions and low-hanging fruit; you then pick feature, brainstorm, roadmap or park. Plus [`/aico:language`](commands.md#aicolanguage) to set the language aico writes in, and approved [design skills](concepts.md#design-skills) for UI work.
- **0.8.1** — [`/aico:cooler`](commands.md#aicocooler) chats are written as a movie script (scenes, stage directions, speaker cues), and the Overheard list is saved in the file instead of shown on screen.
- **0.8.0** — [`/aico:cooler`](commands.md#aicocooler): random colleagues chat at the water cooler, unmoderated, and it is recorded in `.company/cooler/`; plus [`/aico:help`](commands.md#aicohelp) (also `/aico:<command> help`) and [`/aico:version`](commands.md#aicoversion).
- **0.7.0** — Streamlining the company's own workflow: a machine-readable [Handoff Contract](concepts.md#the-handoff-contract), [`/aico:triage`](commands.md#aicotriage) routing, parallel-by-default dispatch, risk-tiered testing, a deterministic reviewer pre-filter, plugin CI, and warm rule packs. No new Roles.

- **0.6.0** — Two on-demand Quality & Security Roles: the [Pentester](roles.md#pentester) (`/aico:pentest`) and the [Vulnerability Scanner](roles.md#vuln-scanner) (`/aico:vulnscan`).
- **0.5.0** — [`/aico:brainstorm`](commands.md#aicobrainstorm): the relevant Roles weigh in on an idea over rounds until you say done, then you choose to build it, roadmap it, keep it as nice-to-have, or park it.
- **0.4.0** — The [Senior Engineer](roles.md#senior-engineer) and the [Ruleset](concepts.md#the-ruleset): sourced Must/Should/May rules per tool, with security as law, via [`/aico:standards`](commands.md#aicostandards).

The full, version-by-version specification is in [`../docs/spec.md`](../docs/spec.md).
