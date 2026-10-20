# aico documentation

**aico** is a Claude Code plugin that runs a small software company for you. You are the **CEO**: you ask for work and approve it at a few checkpoints. A **Lead** turns your request into a route and dispatches 29 specialist **Role** agents, who pass work to one another through files and never skip your approvals.

Start here:

| Guide | What it covers |
|---|---|
| [Getting started](getting-started.md) | Install, your first run, how a job flows, and the three Gates where you approve |
| [Commands](commands.md) | Every `/aico:*` command (the Playbooks), what it does and when to reach for it |
| [Roles](roles.md) | All 29 Role agents, grouped by department, and what each one is for |
| [Concepts](concepts.md) | The ideas the company runs on: Handoffs, Gates, Core/Modules/Contracts, the Ruleset, Debt, Lessons, EU compliance and Git conventions |

Reference material lives alongside these guides:

- [`../README.md`](../README.md) — the short project overview and the company hierarchy diagram
- [`../GLOSSARY.md`](../GLOSSARY.md) — one-line definitions of every term
- [`../docs/spec.md`](../docs/spec.md) — the full specification, version by version
- [`../docs/adr/`](../docs/adr/) — architecture decision records explaining why the company is built the way it is

> Everything the company produces for a given job lands under `.company/` in your product's repository — briefs, designs, code review notes, reports and the per-step Handoff files. You can read any of it; nothing is hidden.

## Version

**Current: 0.7.1** (29 Role agents).

Update an installed copy with:

```
/plugin marketplace update aico
/reload-plugins
```

### What's new

- **0.7.0** — Streamlining the company's own workflow: a machine-readable [Handoff Contract](concepts.md#the-handoff-contract), [`/aico:triage`](commands.md#aicotriage) routing, parallel-by-default dispatch, risk-tiered testing, a deterministic reviewer pre-filter, plugin CI, and warm rule packs. No new Roles.

- **0.6.0** — Two on-demand Quality & Security Roles: the [Pentester](roles.md#pentester) (`/aico:pentest`) and the [Vulnerability Scanner](roles.md#vuln-scanner) (`/aico:vulnscan`).
- **0.5.0** — [`/aico:brainstorm`](commands.md#aicobrainstorm): the relevant Roles weigh in on an idea over rounds until you say done, then you choose to build it, roadmap it, keep it as nice-to-have, or park it.
- **0.4.0** — The [Senior Engineer](roles.md#senior-engineer) and the [Ruleset](concepts.md#the-ruleset): sourced Must/Should/May rules per tool, with security as law, via [`/aico:standards`](commands.md#aicostandards).

The full, version-by-version specification is in [`../docs/spec.md`](../docs/spec.md).
