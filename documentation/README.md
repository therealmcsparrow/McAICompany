# aico documentation

## In short

**aico** is a Claude Code plugin that runs a small software company for you. You are the **CEO**: you ask for work and approve it at a few checkpoints. A **Lead** turns your request into a route and dispatches 36 specialist **Role** agents, who pass work to one another through files and never skip your approvals.

The guide is split by topic. Each page has the same three parts: a short plain summary, the steps, and the exact details.

## How it works

1. New here? Read [Getting started](start/getting-started.md), then [From idea to shipped code](start/idea-to-ship.md).
2. Looking for a command? Open its page under [commands](commands/README.md). There is one page per `/aico:*` command.
3. Want to know why something works the way it does? Read the matching page under [concepts](concepts/README.md).
4. Pick the folder that fits your question:

| Folder | What it covers |
|---|---|
| [start](start/getting-started.md) | Install, your first run, how a job flows, the three Gates where you approve, the [one-time setup](start/setup.md), and [one walk-through from a rough idea to a merged release](start/idea-to-ship.md) |
| [commands](commands/README.md) | Every `/aico:*` command (the Playbooks), what it does and when to reach for it |
| [roles](roles/README.md) | All 36 Role agents, grouped by department, and what each one is for |
| [mods](mods/README.md) | The four mods (Savvy, Cache Tax, Reflect, Blast Radius): what each shows, the shared status line, the cache clock, every `mods.*` setting and the three locks |
| [concepts](concepts/README.md) | The ideas the company runs on: Handoffs, Gates, Core/Modules/Contracts, the Ruleset, Debt, Lessons, company types, personalities, settings and locks, EU compliance and Git conventions |

## Technical details

### Reference material

- [`../README.md`](../README.md): the short project overview and the company hierarchy diagram
- [`../GLOSSARY.md`](../GLOSSARY.md): one-line definitions of every term
- [`../docs/spec.md`](../docs/spec.md): the full specification, version by version
- [`../docs/adr/`](../docs/adr/): architecture decision records explaining why the company is built the way it is

Everything the company produces for a given job lands under `.company/` in your product's repository: briefs, designs, code review notes, reports and the per-step Handoff files. You can read any of it. aico writes no ignore rule for `.company/`. See [Where your words go](concepts/where-your-words-go.md).

### Version

**Current: 0.22.0** (36 Role agents).

Update an installed copy with:

```
/plugin marketplace update aico
/reload-plugins
```

### What's new

- **0.14.0**: A new Role, the reprompter (Lynn), and [`/aico:reprompt`](commands/reprompt.md), which turns a rough prompt into a complete one and never runs it (the prompt is saved as a local file, and it is AI-written, so check it).
- **Unreleased, company types and personalities**: Pick a [company type](concepts/company-types.md) for a project in [`/aico:setup`](commands/setup.md): software (the default, as before), research consultancy, marketing and content agency, or design studio. Each type has its own Roles and Playbooks and its own meaning of "ship". New Playbooks: [`/aico:report`](commands/report.md), [`/aico:campaign`](commands/campaign.md), [`/aico:content`](commands/content.md) and [`/aico:design`](commands/design.md). A new Role, the [editor](roles/README.md) (Edith), checks that every claim is cited. Every Role also gets a [personality](concepts/personalities.md), used only in cooler chats and brainstorms. The settings page has a new look and a Personality tab with a Role filter. The marketing and design checks record Legal's statement; they are not legal advice or a compliance certificate.
- **Unreleased**: A new Role, the skill-researcher (Selin), which finds and vets third-party skills (the Lead scans each pick, installs pin the scanned commit, and a bad scan after the install stops the run) and records approved ones under `## Skills` in `.company/project.md` (see [research and skills](concepts/research-and-skills.md)); [`/aico:skillspector`](commands/skillspector.md), which scans installed skills with SkillSpector (`--project`, `--global` or `--all`; pinned v2.13.1; the install changes your user-scope config and always asks; scan mode `no-llm` by default, set in `/aico:settings` under Skill scan; both modes send dependency names and versions to OSV.dev); and Gates and Steps bars in the [Savvy](mods/savvy.md) pane. Also: cheaper brainstorms (a [format 2](commands/brainstorm.md) digest, a question queue, crossfire debate) and cheaper runs: a [max context](concepts/context-budget.md) setting, a counts-only [token ledger](concepts/token-cost.md) with a cost line at Ship, an opt-in Handoff v1.1 pilot (`pipeline.review_format: pilot`, default `plain`, about 5.7k more tokens per re-review), four [mods](mods/README.md) (Savvy run progress, Cache Tax with a cache clock, Reflect suggested Lessons, and a Blast Radius check before risky commits), tool checks bound to rule IDs, and a release script (`npm run release <x.y.z>`, never pushes). Savings come from reading less; brainstorm Roles keep one constant prompt per run. No saving percentage is claimed yet.
- **0.10.0**: [`/aico:settings`](commands/settings.md): a local page to change each Role's name, model and effort, the language and profile, the Fix-round limit, review lanes and Gates. Settings are saved as a user default or per project. Risky changes are [locked](concepts/settings-and-locks.md) until you unlock them in your user settings. Every Role now has a person name and an [effort level](concepts/roles-and-the-lead.md).
- **0.9.0**: [`/aico:research`](commands/research.md): before you build, three researchers look the topic up online and the Product Manager writes one sourced report with a verdict, ranked actions and low-hanging fruit; you then pick feature, brainstorm, roadmap or park. Plus [`/aico:language`](commands/language.md) to set the language aico writes in, and approved [design skills](concepts/research-and-skills.md) for UI work.
- **0.8.1**: [`/aico:cooler`](commands/cooler.md) chats are written as a movie script (scenes, stage directions, speaker cues), and the Overheard list is saved in the file instead of shown on screen.
- **0.8.0**: [`/aico:cooler`](commands/cooler.md): random colleagues chat at the water cooler, unmoderated, and it is recorded in `.company/cooler/`; plus [`/aico:help`](commands/help.md) (also `/aico:<command> help`) and [`/aico:version`](commands/version.md).
- **0.7.0**: Streamlining the company's own workflow: a machine-readable [Handoff Contract](concepts/handoffs.md), [`/aico:triage`](commands/triage.md) routing, parallel-by-default dispatch, risk-tiered testing, a deterministic reviewer pre-filter, plugin CI, and warm rule packs. No new Roles.
- **0.6.0**: Two on-demand Quality & Security Roles: the [Pentester](roles/pentester.md) (`/aico:pentest`) and the [Vulnerability Scanner](roles/vuln-scanner.md) (`/aico:vulnscan`).
- **0.5.0**: [`/aico:brainstorm`](commands/brainstorm.md): the relevant Roles weigh in on an idea over rounds until you say done, then you choose to build it, roadmap it, keep it as nice-to-have, or park it.
- **0.4.0**: The [Senior Engineer](roles/senior-engineer.md) and the [Ruleset](concepts/ruleset-and-debt.md): sourced Must/Should/May rules per tool, with security as law, via [`/aico:standards`](commands/standards.md).

The full, version-by-version specification is in [`../docs/spec.md`](../docs/spec.md).
