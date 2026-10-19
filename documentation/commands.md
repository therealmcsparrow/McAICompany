# Commands

Every command is a **Playbook**: a fixed, named sequence of Roles for a recurring kind of work. Type it in Claude Code with the plugin installed. If you're not sure which fits, use `/aico:lead` and let the Lead choose.

Arguments in `<angle brackets>` are required; `[square brackets]` are optional.

## Build and change

### `/aico:lead`
`/aico:lead <what you want done>`
The front door. The Lead reads your request, and either switches to the matching command below or builds a custom route from the Roles it needs. Use it whenever no specific command obviously fits.

### `/aico:feature`
`/aico:feature <feature description>`
Build a feature or a whole new product end to end: brief → plan (Core + Contracts + design) → build per Module → review, QA, security and compliance in parallel → docs → ship. Has all three Gates (Brief, Plan, Ship).

### `/aico:fix`
`/aico:fix <bug description or issue link>`
Fix a bug. QA reproduces it with a failing test, the engineer fixes it test-first, it's reviewed, then shipped. Has a Ship Gate.

### `/aico:refactor`
`/aico:refactor <scope>`
Restructure existing code toward Core, Modules and Contracts in safe slices, with no change in behavior. Good for paying down structural debt.

### `/aico:incident`
`/aico:incident <what happened>`
Handle a production incident fast: mitigate first, check EU reporting duties (CRA and GDPR deadlines), fix, then write the postmortem. Urgency is allowed, but the Ship Gate stays.

## Assess (read-only — no code changes)

### `/aico:audit`
`/aico:audit [path or scope]`
A prioritized report on an existing codebase: quality, test coverage, security, dependency licenses, performance against budget, ruleset compliance and how far the code is from Core/Modules/Contracts. Ends with the top recommended next actions.

### `/aico:pentest`
`/aico:pentest <target> [full]`
On-demand authorized red-team test of **your own** product on a local or staging build. The Pentester attacks the running build, chains weaknesses, and reports findings ranked by severity. By default it proves each finding with a safe reproduction; add `full` to allow real end-to-end exploit chains (still local-only, no real user data). A production target needs an explicit authorization line, or the run stops. See [the Pentester role](roles.md#pentester) for the rules of engagement.

### `/aico:vulnscan`
`/aico:vulnscan`
On-demand scan of your dependencies and code against published vulnerability databases (NVD/CVE, OSV, GitHub Advisories, vendor advisories, CISA KEV). Critical/High findings — and anything known to be actively exploited — come to you to act on; the safe lower-severity fixes arrive as a ready upgrade set you can run with `/aico:maintain`.

### `/aico:feedback`
`/aico:feedback <reports: path, paste or export>`
Turn user feedback, reviews and support reports into ranked, de-duplicated fix and feature proposals you pick from. Builds nothing on its own.

### `/aico:usability-test`
`/aico:usability-test <what to test> [real-users]`
Every Persona tests a design, URL or app in parallel — walkthrough, hands-on and accessibility — and you get one combined report. Add `real-users` to plan a test with real people.

## Upkeep and standards

### `/aico:maintain`
`/aico:maintain`
Routine upkeep: outdated dependencies, known vulnerabilities, license re-check, CI health and stale rule packs. You pick which upgrades to apply; then they're built, reviewed and shipped.

### `/aico:standards`
`/aico:standards [tool | refresh]`
The Senior Engineer researches sourced best-practice rules for a tool (or `refresh` to re-check the existing ruleset), the Architect signs off, and any exceptions come to you. This builds and maintains the product's [Ruleset](concepts.md#the-ruleset).

### `/aico:brainstorm`
`/aico:brainstorm <idea | file>`
Pitch an idea and the relevant Roles weigh in, round after round, until you say done. Modes: **ideas** (Roles answer in parallel, the default), **debate** (Roles respond to each other) and **moderated** (one Role at a time). At the end you choose to plan and implement, put it on the roadmap, keep it as nice-to-have, or park it. Pass a saved brainstorm file to reopen it.

## Clients and launch

### `/aico:client`
`/aico:client intake <client request> | handoff`
`intake` produces a client brief, estimate and proposal; `handoff` assembles the client handoff package.

### `/aico:launch`
`/aico:launch <product or release>`
Positioning, copy, release notes and privacy/terms for going public, through to a Ship Gate.

## Setup

### `/aico:setup`
`/aico:setup [core] [go] [react] [tanstack] [auth]`
Install the standalone skills (no arguments) or add optional stack skill groups the Roles use.

---

You can also summon any Role directly, without a command — for example *"use the aico security agent on `src/auth`"* or *"use the aico pentester on the staging build"*. See [Roles](roles.md).
