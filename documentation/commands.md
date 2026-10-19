# Commands

Every command is a **Playbook**: a fixed, named sequence of Roles for a recurring kind of work. Type it in Claude Code with the plugin installed. If you're not sure which fits, use `/aico:lead` (or `/aico:triage`) and let the company choose.

Arguments in `<angle brackets>` are required; `[square brackets]` are optional. Most commands run through the shared pipeline, so a few conventions hold everywhere:

- **Gates** are where the company stops for your approval — **Brief** (scope), **Plan** (design), **Ship** (before anything leaves the repo). At each you Approve, Change or Stop. A Playbook only skips a Gate if its own description says so.
- **Work lands under `.company/`** in your repo: the brief, designs, reviews, reports and the per-step Handoff files. `<slug>` below is the short task name the run picks.
- **Nothing is pushed, merged, deployed or sent** before the Ship Gate.
- **Read-only** commands (audit, feedback, usability-test, pentest, vulnscan) change no code — they end in a report you act on.

Each entry below gives what the command does, when to reach for it, how it runs (Gates marked), what you get, and an example.

---

## Build and change

### `/aico:lead`
`/aico:lead <what you want done>`

**What it does.** The front door. The Project Manager reads your request and either recognizes a known kind of work and switches to the matching command, or builds a custom route from just the Roles the job needs.

**When to use it.** Any time — especially when no single command below obviously fits, or when the work spans several kinds (e.g. "fix this bug and write release notes").

**How it runs.**
1. Classifies the request; if unsure of size or risk, it can run `/aico:triage` first.
2. Picks the Roles and sequences them (independent Roles run in parallel).
3. Shows you the route and its one-line reading of the goal. **→ Brief Gate** when the route has no Product Manager step (otherwise the Brief Gate comes after the brief).
4. Runs the route, pausing at each Gate.

**You get.** Whatever the chosen route produces, plus a short run summary at the end.

**Example.** `/aico:lead let users export their data as CSV from the settings page`

### `/aico:triage`
`/aico:triage <request>`

**What it does.** A fast pre-router that builds nothing. It classifies a request by **size** (XS → L), **risk tier** (low/medium/high) and **type**, then recommends the *shortest valid route* and the Gates that route keeps — so a one-line change doesn't pay the ceremony of a full feature.

**When to use it.** When you can't tell how big or risky a request is, or want to avoid over-processing a trivial change. `/aico:lead` can run it for you.

**How it runs.**
1. Reads `.company/project.md` and your request; classifies size, risk and type.
2. Recommends the shortest route that the risk still allows. **Risk overrides size:** anything touching auth, payments, personal data, migrations or a Contract keeps the full reviewer lane and every Gate, however small.
3. Presents size + risk + type + route. **→ Brief Gate** (Approve / Change / Stop). On approve, hands straight to the chosen route.

**You get.** A one-line recommendation; the risk tier then travels into every dispatch of the real run.

**Example.** `/aico:triage change the footer copyright year to be dynamic`

### `/aico:feature`
`/aico:feature <feature description>`

**What it does.** Builds a feature or a whole new product end to end, from brief to shipped.

**When to use it.** New functionality or a new product — anything that adds or materially changes behavior.

**How it runs.**
1. **Product Manager** writes the brief: problem, users, scope, IDed acceptance criteria, risk tier. **→ Brief Gate.**
2. **Architect** ∥ **UI/UX Designer** (if there's UI) ∥ **Brand Artist** (if new art is needed) produce the Core list, Contracts, Module map and wireframes. Persona testers walk the design; the **Senior Engineer** researches or maps the ruleset; the Architect signs it off if Must rules changed. **→ Plan Gate** (you approve Core, Contracts and art direction).
3. **Builders** build one Module each (in parallel once Contracts are settled), test-first, following the rules mapped to their tasks. Assets are produced alongside.
4. **Code Reviewer** ∥ **QA** ∥ **Security** ∥ **Senior Engineer** (compliance) review in parallel (plus **Legal** for AI/payments/personal data, and hands-on + accessibility testers for UI). Blocking findings go back to the builder — at most two Fix rounds.
5. **Writer** adds docs and release notes; **Localizer** translates if you support more than one language. **→ Ship Gate.**
6. **DevOps** releases as approved.

**You get.** Shipped code on a branch, tests, docs, and the full Handoff trail under `.company/work/<slug>/`.

**Example.** `/aico:feature a dark-mode toggle that remembers the user's choice`

### `/aico:fix`
`/aico:fix <bug description or issue link>`

**What it does.** Fixes a bug, test-first. The bug report is the brief, so there's no Brief or Plan Gate (unless the fix needs a Core or Contract change, which forces a Plan Gate).

**When to use it.** Something is broken and you want it fixed with a regression test that proves it stays fixed.

**How it runs.**
1. **QA** reproduces the bug and writes a failing regression test, naming the suspect Module.
2. The **engineer** who owns that Module finds the root cause and fixes it test-first.
3. **Code Reviewer** ∥ **QA** (re-runs the full suite + the regression test) ∥ **Security** (if the bug touches auth, input or data). Fix rounds apply. **→ Ship Gate.**
4. **DevOps** releases if needed.

**You get.** The fix, a regression test that failed before and passes now, and the review trail.

**Example.** `/aico:fix uploading a file over 5 MB silently fails with no error message`

### `/aico:refactor`
`/aico:refactor <scope>`

**What it does.** Restructures existing code toward Core, Modules and Contracts in safe slices, with **no change in behavior**. The audit report is the brief.

**When to use it.** The code works but is hard to change — tangled Modules, leaky boundaries, missing Contracts. Not for adding behavior (use `/aico:feature`) or fixing bugs (use `/aico:fix`).

**How it runs.**
1. **Architect** defines the target Core, Module map, Contracts and the slices (each slice moves one Module out). The **Senior Engineer** maps the ruleset and the Architect signs off if Must rules changed. **→ Plan Gate.**
2. Per slice, in order: **QA** writes characterization tests of current behavior (they must pass first) → the owning **engineer** moves the code behind the Contract with no behavior change → **Code Reviewer** ∥ **QA** ∥ **Senior Engineer** confirm the same tests still pass. **→ Ship Gate** (per slice).

**You get.** The same behavior behind cleaner boundaries, slice by slice, each independently shippable. Old rule violations are logged as Debt, never fixed inside a slice.

**Example.** `/aico:refactor extract the billing logic out of the user service into its own Module`

### `/aico:incident`
`/aico:incident <what happened>`

**What it does.** Handles a production incident fast: mitigate first, check EU reporting duties, fix, then write the postmortem. Urgency is allowed; the Ship Gate stays.

**When to use it.** An outage, data loss, or a security event in something already live.

**How it runs.**
1. **DevOps** triages (impact, scope, timeline) and proposes a mitigation, ∥ **Security** if security-related, ∥ **Legal** (drafts reports early).
2. **→ Ship Gate (mitigation only)** — rollback or feature flag; you can approve in one line. DevOps applies it.
3. **Legal** checks reporting duties and drafts every report due before the fix ships (CRA 24 h / 72 h, GDPR 72 h). **→ Ship Gate (reports)**, repeated per deadline — each draft comes to you with its clock time; you submit.
4. The **fix** runs the `/aico:fix` route.
5. **DevOps** writes the postmortem. **→ Ship Gate** before any report is sent or the fix is deployed.

**You get.** A mitigation, drafted regulatory notices with deadlines, the fix, and a postmortem with root cause and follow-ups.

**Example.** `/aico:incident the login API is returning 500s for about half of requests since 14:00`

---

## Assess (read-only — no code changes)

### `/aico:audit`
`/aico:audit [path or scope]`

**What it does.** A prioritized report on an existing codebase across quality, tests, security, licenses, performance and architecture.

**When to use it.** You've inherited or neglected code and want to know where it stands before investing — or as the groundwork for a refactor.

**How it runs.**
1. In parallel: **Code Reviewer** (quality, Core/Module/Contract conformance), **QA** (coverage, runs the suite, performance vs budget), **Security** (vulnerabilities, dependency audit), **Legal** (licenses, GDPR exposure), and the **Senior Engineer** (ruleset compliance of the whole codebase — findings are Debt, not blocking).
2. The Lead merges the lanes into one report: Critical / Important / Minor with file:line, owner and fix size; performance vs budget; ruleset violations; how far the code is from Core/Modules/Contracts; and the top 5 next actions.
3. Presented to you, with an offer to start `/aico:fix` or `/aico:feature` runs for what you pick.

**You get.** `.company/work/<slug>/report.md` — a ranked, actionable assessment. No code changes.

**Example.** `/aico:audit src/payments`

### `/aico:pentest`
`/aico:pentest <target> [full]`

**What it does.** On-demand authorized red-team test of **your own** product on a local or staging build. The Pentester attacks the running build, chains weaknesses, and reports findings ranked by severity.

**When to use it.** You want to know how a real attacker would get in — beyond the static review `security` already does.

**How it runs.**
1. Confirms the target is your own product and states the scope. By default it proves each finding with a **safe reproduction**; add `full` to allow real end-to-end exploit chains (still local/staging only, no real user data). A production target needs an explicit authorization line or the run stops.
2. **Pentester** maps the attack surface and plans, then executes — chaining weaknesses into real paths.
3. Report ranked by severity. An exploitable production-facing path is flagged for `/aico:incident`; for the rest you pick which become `/aico:fix` runs.

**You get.** `.company/work/<slug>/pentest-report.md` with reproductions and fix directions. No code changes.

**Example.** `/aico:pentest http://localhost:3000 full`

### `/aico:vulnscan`
`/aico:vulnscan`

**What it does.** On-demand scan of your dependencies and code against published vulnerability databases (NVD/CVE, OSV, GitHub Advisories, vendor advisories, CISA KEV).

**When to use it.** You want a point-in-time supply-chain check — what in your tree is known-vulnerable right now, and what version fixes it.

**How it runs.**
1. **Vuln-scanner** enumerates your real dependency tree and matches each against advisory ranges, using primary sources only, recording a source URL for every finding.
2. It splits results: **Critical/High** (and anything KEV-listed or actively exploited) into a report for you to act on — a KEV hit is Blocking and suggests `/aico:incident`; **Medium/Low** into a ready **upgrade set** you can apply in one `/aico:maintain` run.

**You get.** `.company/work/<slug>/vuln-report.md` with `## Report` and `## Upgrade set`. No tree changes.

**Example.** `/aico:vulnscan`

### `/aico:feedback`
`/aico:feedback <reports: path, paste or export>`

**What it does.** Turns user feedback, reviews and support reports into ranked, de-duplicated fix and feature proposals you pick from.

**When to use it.** You have a pile of user input and want it triaged into a short list of things worth doing.

**How it runs.**
1. **Support** clusters the reports (and stops to suggest `/aico:incident` if a cluster looks security-related).
2. **Product Manager** ranks the top 5 against your success metric and proposes a fix or feature for each. **→ Brief Gate** (you pick).
3. The Lead tells you which `/aico:fix` and `/aico:feature` runs to start — it never starts them itself.

**You get.** `.company/work/<slug>/feedback-report.md` — clustered, ranked proposals. Builds nothing.

**Example.** `/aico:feedback ./support-tickets-oct.csv`

### `/aico:usability-test`
`/aico:usability-test <what to test> [real-users]`

**What it does.** Every Persona tests a design, URL or app in parallel — walkthrough, hands-on and accessibility — and you get one combined report.

**When to use it.** Before or after building, to see whether real users of each Persona can actually complete the key tasks.

**How it runs.**
1. If the project has no Personas yet, the **Product Manager** proposes 2–4. **→ Brief Gate** (you approve them).
2. In parallel, one per Persona: **Persona Tester** (designs/prototype), **Hands-on Tester** (running app), and the **Accessibility Tester** (WCAG, once).
3. The Lead merges a report: a verdict per Persona, S1/S2/S3 findings de-duplicated with "n of N Personas hit this", and the top 5 changes with owners.
4. With `real-users`: the **UX Researcher** writes a test plan, screener, script and consent; **Legal** checks the consent. **→ Ship Gate** before any outreach.
5. S1 findings are Blocking and fixed before Ship; you pick which S2/S3 to fix (as a new `/aico:feature` or `/aico:fix` run).

**You get.** `.company/work/<slug>/usability-report.md`. No code changes in the test itself.

**Example.** `/aico:usability-test ./designs/checkout-flow.png`

---

## Upkeep and standards

### `/aico:maintain`
`/aico:maintain`

**What it does.** Routine upkeep: outdated dependencies, known vulnerabilities, license re-check, CI health and stale rule packs — then applies the upgrades you pick.

**When to use it.** On a schedule (monthly works well) or whenever the project has drifted.

**How it runs.**
1. In parallel: **Security** (dependency vulnerabilities; stops for `/aico:incident` if one is exploited), **Legal** (license re-check), **DevOps** (outdated deps, SBOM status, CI health), **Senior Engineer** (refresh: stale packs, changed guidance, new advisories).
2. The Lead merges a report: Critical / Important / Minor with owner and size. **→ Brief Gate** (you pick upgrades).
3. The owning engineer applies each chosen upgrade group, then **Code Reviewer** ∥ **QA** ∥ **Security**. **→ Ship Gate.**

**You get.** `.company/work/<slug>/maintenance-report.md` and the upgrades you approved, shipped.

**Example.** `/aico:maintain`

### `/aico:standards`
`/aico:standards [tool | refresh]`

**What it does.** The Senior Engineer researches sourced best-practice rules for a tool (or `refresh` to re-check the existing ruleset), the Architect signs off, and any exceptions come to you. This builds and maintains the product's **Ruleset**.

**When to use it.** When adopting a new tool, standing up the ruleset for a project, or periodically to keep rules current. This is also how the "warm rule packs" get their content — one run per stack.

**How it runs.**
1. **Senior Engineer** researches the named tool (mode *research*), or reports what's stale/changed (mode *refresh*) for you to pick from. Rules come from primary sources only.
2. **Architect** signs off — but only when Must rules were added or changed. A rejected rule gets one revision, then you decide.
3. Exception requests and new Debt come to you in one round. **→ Ship Gate** (commits the `.company/standards.md` and pack changes).

**You get.** Updated rule packs in the library and committed copies in `.company/standards/`, plus the project's `.company/standards.md`.

**Example.** `/aico:standards react` · `/aico:standards refresh`

### `/aico:brainstorm`
`/aico:brainstorm <idea | file>`

**What it does.** Pitch an idea and the relevant Roles weigh in, round after round, until you say done — then you choose what happens to it.

**When to use it.** Early thinking: you have a direction, not a spec, and want the company's angles on it before committing.

**How it runs.**
1. The Lead picks the 4–8 Roles whose angle matters and opens a notes file in `.company/brainstorms/`.
2. **Rounds** in one of three modes — **ideas** (Roles answer in parallel, the default), **debate** (Roles respond to each other), **moderated** (one at a time). After each round you get a digest; your reply steers the next. You can switch mode or add/drop Roles anytime. It runs until you say **done**.
3. At the close, you choose: **plan and implement** (continues as `/aico:feature` from the notes), **roadmap**, **nice to have**, or **park**. The file moves to the matching folder; `/aico:brainstorm "<file>"` reopens it later.

**You get.** `.company/brainstorms/YYYY-MM-DD HH.MM - Topic.md` with the summary and every round. Builds nothing until you choose to.

**Example.** `/aico:brainstorm debate how should we onboard first-time users`

---

## Clients and launch

### `/aico:client`
`/aico:client intake <client request> | handoff`

**What it does.** `intake` turns a client request into a brief, estimate and proposal; `handoff` packages finished work for the client.

**When to use it.** Client (agency) work rather than your own products. It sets `engagement: client` and the client's license and jurisdiction in the project profile.

**How it runs.**
- **intake:** **Account Manager** gathers goals, constraints, budget and open questions → **Product Manager** writes the brief → **Architect** proposes Core/Modules and an effort estimate. **→ Brief Gate.** Then **Account Manager** writes the proposal in the client's voice. **→ Ship Gate** (before anything goes to the client). Building then runs via `/aico:feature`, which you start.
- **handoff:** **Writer** ∥ **DevOps** produce user/admin docs plus a deployment runbook and credentials checklist (no secrets in files) → **Legal** checks license/IP transfer → **Account Manager** writes the handoff letter. **→ Ship Gate.**

**You get.** A client-ready proposal or handoff package under `.company/work/<slug>/`.

**Example.** `/aico:client intake build an internal booking tool for a dental practice`

### `/aico:launch`
`/aico:launch <product or release>`

**What it does.** Takes a product or release public: positioning, landing/store copy, release notes, privacy and terms.

**When to use it.** You're about to announce or publish something and want the messaging, assets and legal pieces done together.

**How it runs.**
1. **Product Manager** writes the launch brief (audience, key message, channels, success metric). **→ Brief Gate.**
2. In parallel: **Marketer** (positioning, landing/store copy, SEO, announcements), **Writer** (release notes, getting-started), **Legal** (privacy, terms, consent, claims check), plus **Brand Artist** ∥ **Prompt Artist** ∥ **Motion Artist** for images, hero art and a demo storyboard.
3. **Marketer** merges Legal's changes and the asset list into final copy; **Localizer** translates if you support more than one language; **Frontend Engineer** builds the landing page if needed. **→ Ship Gate** (nothing is published before this).
4. **DevOps** publishes.

**You get.** Launch copy, assets, release notes and legal pages, ready to publish.

**Example.** `/aico:launch the 2.0 release of our note-taking app`

---

## Setup

### `/aico:setup`
`/aico:setup [core] [go] [react] [tanstack] [auth]`

**What it does.** Installs the standalone skills the Roles rely on (no arguments → the `core` group), or adds optional stack skill groups.

**When to use it.** Once after installing the plugin, and again whenever you start working in a stack whose skills you haven't added yet.

**How it runs.** It shows you the install commands first (they download third-party code) and asks once to approve; on approval it installs, then tells you to reload so the new skills appear.

**You get.** The standalone and stack skills available to the Roles.

**Example.** `/aico:setup go react`

---

You can also summon any Role directly, without a command — for example *"use the aico security agent on `src/auth`"* or *"use the aico pentester on the staging build"*. See [Roles](roles.md).
