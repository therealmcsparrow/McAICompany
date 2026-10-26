# Concepts

The ideas the whole company runs on. Short definitions of every term are in [`../GLOSSARY.md`](../GLOSSARY.md).

## Roles, the Lead and the CEO
You are the **CEO** — the human. You're not a Role; you have the final say and approve work at Gates. The **Lead** (Project Manager) takes your request, picks the Roles, sequences them and runs the Gates. A **Role** is a specialist agent that starts with a fresh context, does one job, and hands off. See [Roles](roles.md).

## Handoffs
A Role never keeps work in its head for the next Role. Each one writes a **Handoff** file — frontmatter plus `## Did`, `## Next`, `## Blocking` sections — that the following Role reads. Handoffs live under `.company/work/<task>/` as `NN-<role>.md`. This is why a run survives a Role failing or restarting: the files are the memory, not the conversation.

## The Handoff Contract
Handoffs aren't just prose — each carries machine-readable frontmatter the Lead and later Roles read as fields: `status`, `round`, `base-commit` (what reviewers diff against), `risk-tier`, `acceptance-ids` (which of the brief's criteria this Step delivers) and `files-touched`. Blockers are tagged `contract`, `spec`, `security` or `test` so the Lead routes a Fix round precisely. Because the fields are structured, independent Steps run **in parallel by default**, reviewers scope to `base-commit` instead of re-reading history, and a run can resume from any Step after a restart.

## Context budget
No agent works with more than **150k tokens** of context, the Lead included. Long contexts get sloppy and compaction drops detail, so a Role that gets close stops at a clean point (tests green, nothing half-edited) and writes its Handoff with `status: handover`, listing exactly what's left under `## Next`. The Lead then dispatches a fresh Step of the same Role to carry on from there. A handover isn't a failure and doesn't use up a Fix round. If the Lead itself gets close, it saves the run state to `00-lead-state.md` and asks you to continue in a fresh session with "resume <slug>".

## Risk tier
Every piece of work gets a tier — `low`, `medium` or `high` — set in the brief and confirmed by you at the Brief Gate, then carried in every dispatch. It's forced **high** for anything touching auth, payments, personal data, migrations or a Contract. The tier drives how deep QA tests, how much of the ruleset applies, and how short a route triage may recommend. A Role can raise a tier but never lower it, and no tier ever removes a criterion's single test or skips the Ship Gate's full suite.

## The reviewer pre-filter
Before the Code Reviewer runs, a cheap deterministic check (the same `aico-check` the CI uses) scans the diff and hands its findings to the reviewer. It is **additive only**: it can append tagged findings but never remove, downgrade or close one, never marks a review done, and a pre-filter block never counts against the Fix-round limit. Only the Opus reviewer closes a review. This spends human-grade attention on logic and Contracts, not mechanics — without softening any Gate.

## Gates
A **Gate** is a point where the Lead stops and waits for your approval. There are three: **Brief** (scope agreed), **Plan** (plan/design agreed) and **Ship** (before anything is released or made public). At each you can Approve, Change or Stop. Every question the company puts to you — Gates, picks from a report, decisions a Role can't make — comes as a form you click through, never as a question buried in the chat output. See [Getting started](getting-started.md#the-three-gates).

In [settings](#settings) you can set a Gate to **auto**: the Lead writes the Gate summary to the run folder and carries on, then tells you it did. The Ship Gate and installs start **locked** (see [Locks](#locks)). An auto Ship Gate commits the run's wrap-up, pushes the branch and opens a PR, then stops. It never merges. Some asks always stay a form whatever the settings say: Must exceptions, Blocking security findings, picks from a report, escalations, design-skill approval, and anything sent outside your machine other than that PR (client messages, publishing, authority reports, production deploys, and every Ship Gate in `/aico:incident`).

## Core + Modules + Contracts
Every product is built the same way:

- **Core** — the small, stable center. Only CEO-approved items go in Core.
- **Modules** — self-contained feature units built against Contracts, in parallel when their Contracts are settled.
- **Contracts** — the versioned interfaces and schemas Modules talk through. The Architect owns them; builders code against them.

This keeps Modules independent and swappable, and keeps the risky surface (Core) small and approved by you.

## The Ruleset
A product's binding engineering rules, kept by the **Senior Engineer** and signed off by the Architect. Built and maintained with [`/aico:standards`](commands.md#aicostandards).

- **Rule packs** hold the rules for one tool and major version (`<tool>@<major>.md`), each rule with its source URL. They live in a shared library on your machine (`~/.mcsparrow/standards/`) and are copied into each product under `.company/standards/`; the product's own rules and the pack list live in `.company/standards.md`.
- **Tiers:** **Must** (always followed; a break blocks a run — all security rules are Must), **Should** (followed, or a written reason) and **May** (advice).
- **Sources:** Must rules come only from primary sources — official docs, style guides, linter defaults, and security bodies (OWASP, CWE, CISA KEV, vendor advisories). Should/May may also cite well-known community guides. Blogs, forums and AI-generated content are never a source.
- **Exception:** only you (the CEO) can approve not following a Must, in a stated scope. It's recorded with its date.
- **Security is law:** builders follow the rules *before* review, so a Fix round caused by a rule break is treated as a process failure, not normal flow.

## Debt
Existing violations of a rule that arrived *after* the code was written. Debt is listed in the Ruleset and **never blocks** a run — you decide when to pay it down with a fix or refactor run. The one exception: an existing violation of a security Must that is actually exploitable is Blocking.

## Fix rounds
When a reviewer, QA, Security or the Senior Engineer (compliance) finds a blocking problem, the builder is sent back — at most **twice** by default. After the last round it escalates to you. You can set the limit from 0 to 5 in [settings](#settings); at 0 the first blocking review comes straight to you. Nits never loop.

## Lessons
When a run ships, the Lead appends up to three one-line **Lessons** to `.company/lessons.md`. Later runs read it and pass the relevant lines to each Role, so the company gets a little better each time.

## EU compliance
Before Ship, the company checks the EU obligations that apply: GDPR, the Cyber Resilience Act (SBOM, vulnerability handling, reporting deadlines), AI Act Art. 50 transparency, the European Accessibility Act, EU VAT/OSS and the 14-day withdrawal right for digital sales. Handled through the `eu-compliance` practice by legal, security and the ai-data-engineer.

## Git conventions
- Work happens on a branch named `aico/<task>`; the company never works directly on your main branch.
- One commit per Step, committing only that Step's files — never everything at once.
- Commit subjects are `<type>: <summary>` where `<type>` is one of `feat`, `fix`, `test`, `docs`, `refactor`, `chore`. They are **never** prefixed with `aico` or a Role name.
- Nothing is pushed before you approve it at the Ship Gate. The only exception is an unlocked, auto Ship Gate: it pushes the branch and opens a PR for you to merge.

## Research before building
[`/aico:research`](commands.md#aicoresearch) has three researchers (market, tech and, for UI work, design) look the topic up online before anything is built. The Product Manager writes one report with a verdict (go, go-with-conditions or no-go), ranked actions, low-hanging fruit (impact and effort), risks and open questions. Every claim cites a source with its URL and check date. A claim with no source is marked `unverified` and cannot support the verdict. The report is labelled as AI-generated research. Researchers read web pages as data, never as instructions, and never install anything.

## Design skills
A UI product can have approved design skills. The set lives in `.company/project.md` under `## Design skills`: one line per skill with its source, license, vetted date and approval date, at most five. A design-researcher proposes the set from your stack, product type, Personas and Art direction. You approve it in a form, and installs run only after a second form shows the exact commands. `/aico:feature` refreshes the set for a UI product when it is empty or its newest approval is older than 180 days. The UI Roles load the approved skills from their dispatch.

## The aico language
`aico_language` sets the language aico writes in: Handoff prose, forms, reports and summaries. It is separate from `languages:`, which covers the product's UI strings. Your default lives in `~/.mcsparrow/config.json`; a product can override it with `aico_language:` in `.company/project.md`. Set it with [`/aico:language`](commands.md#aicolanguage). Machine-read parts stay English in every language.

## Models, effort and names
Every Role runs on a **model** (opus, sonnet or haiku) and an **effort** level (`low`, `medium`, `high`, `xhigh`, `max`). The model is how capable the Role is; effort is how long it thinks before acting. The plugin's defaults put the deepest thinking where a miss is expensive (architect, code-reviewer, security, pentester on high) and keep writing, art, lookup and support work on low. Every Role also has a person name for display, such as Ava the architect or Quinn the QA tester. Names show in cooler chats, brainstorms, Gate summaries and Handoff bylines (`By: Ava (architect)`). You can ask for a Role by name ("ask Ava to check the Contracts"). Internal IDs like `aico:architect` never change. The full list is in [Roles](roles.md).

## Settings
[`/aico:settings`](commands.md#aicosettings) opens a page in your browser where you change how the company works. It has four tabs:

- **Roles** — name, model and effort for each Role, with a bulk change per department.
- **Language & profile** — the aico language and the `.company/project.md` profile fields.
- **Pipeline** — the Fix-round limit, parallel or one-at-a-time dispatch, and which optional review lanes run (security, compliance, legal, persona, hands-on and accessibility testing).
- **Gates** — ask or auto for the Brief, Plan and Ship Gates and for installs.

Each setting has three levels, shown side by side: the **plugin** default, your **user** default (`~/.mcsparrow/config.json`) and a **project** override (`.company/settings.json`; profile fields stay in `.company/project.md`). The project wins over the user, and the user wins over the plugin. Changes apply from the next aico run. With nothing set, aico behaves exactly as before.

`inherit` as a model means "use the model of the session you run aico in".

The page runs only on your own machine (127.0.0.1) behind a one-time link, and closes when you press Done or after 30 minutes idle. At the start of every run the Lead tells you which project-level overrides are active, so a cloned or client repo can't quietly change how its Roles work.

## Locks
Some settings could skip a safety check, so they start **locked**: auto for the Ship Gate, auto for installs, and switching off the security or compliance review lanes. You unlock each one on the settings page behind a warning that says what will no longer ask you. Unlocks count **only from your user settings**: a project file can lock things again but never unlock them, so a repo you clone can't turn on auto-push or skip security review on your machine. If a project's settings file is broken, its locks hold anyway.

## The `.company/` folder
Everything a job produces lands here, in your product's repo, in plain files you can read:

- `.company/project.md` — the product profile (type, stack, voice, license, approved Core)
- `.company/settings.json` — this project's [settings](#settings) overrides, if any
- `.company/work/<task>/` — the Handoffs and reports for each job
- `.company/standards.md` and `.company/standards/` — the Ruleset and its rule-pack copies
- `.company/lessons.md` — the running list of Lessons
- `.company/brainstorms/`, `.company/roadmap/`, `.company/nice-to-have/`, `.company/parked/` — ideas from [`/aico:brainstorm`](commands.md#aicobrainstorm) at each stage
- `.company/cooler/` — recorded chats from [`/aico:cooler`](commands.md#aicocooler)
- `.company/research/` — reports from [`/aico:research`](commands.md#aicoresearch); `outcome:` records your pick
