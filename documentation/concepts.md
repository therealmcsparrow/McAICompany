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
Before the Code Reviewer runs, a cheap deterministic check (the same `aico-check` the CI uses) scans the diff and hands its findings to the reviewer. It is **additive only**: it can append tagged findings but never remove, downgrade or close one, never marks a review done, and a pre-filter block never counts against the two Fix rounds. Only the Opus reviewer closes a review. This spends human-grade attention on logic and Contracts, not mechanics — without softening any Gate.

## Gates
A **Gate** is a point where the Lead stops and waits for your approval. There are three: **Brief** (scope agreed), **Plan** (plan/design agreed) and **Ship** (before anything is released or made public). At each you can Approve, Change or Stop. Every question the company puts to you — Gates, picks from a report, decisions a Role can't make — comes as a form you click through, never as a question buried in the chat output. See [Getting started](getting-started.md#the-three-gates).

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
When a reviewer, QA, Security or the Senior Engineer (compliance) finds a blocking problem, the builder is sent back — at most **twice**. After two rounds it escalates to you. Nits never loop.

## Lessons
When a run ships, the Lead appends up to three one-line **Lessons** to `.company/lessons.md`. Later runs read it and pass the relevant lines to each Role, so the company gets a little better each time.

## EU compliance
Before Ship, the company checks the EU obligations that apply: GDPR, the Cyber Resilience Act (SBOM, vulnerability handling, reporting deadlines), AI Act Art. 50 transparency, the European Accessibility Act, EU VAT/OSS and the 14-day withdrawal right for digital sales. Handled through the `eu-compliance` practice by legal, security and the ai-data-engineer.

## Git conventions
- Work happens on a branch named `aico/<task>`; the company never works directly on your main branch.
- One commit per Step, committing only that Step's files — never everything at once.
- Commit subjects are `<type>: <summary>` where `<type>` is one of `feat`, `fix`, `test`, `docs`, `refactor`, `chore`. They are **never** prefixed with `aico` or a Role name.
- Nothing is pushed before you approve it at the Ship Gate.

## The `.company/` folder
Everything a job produces lands here, in your product's repo, in plain files you can read:

- `.company/project.md` — the product profile (type, stack, voice, license, approved Core)
- `.company/work/<task>/` — the Handoffs and reports for each job
- `.company/standards.md` and `.company/standards/` — the Ruleset and its rule-pack copies
- `.company/lessons.md` — the running list of Lessons
- `.company/brainstorms/`, `.company/roadmap/`, `.company/nice-to-have/`, `.company/parked/` — ideas from [`/aico:brainstorm`](commands.md#aicobrainstorm) at each stage
