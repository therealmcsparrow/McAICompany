# Glossary

**Skillset** — the whole AI-company package, delivered as one installable Claude Code plugin.

**Role** — a job in the company (e.g. Backend Engineer, Security Engineer). Works in its own isolated context and is called in when its expertise is needed. A Role *uses* Practices; it does not contain them.

**CEO** — the human user. Not a Role. Has the final say and approves work at Gates.

**Lead** — the single front door, played by the **Project Manager** Role. Takes any request, decides which Roles are needed, sequences them, and tracks status. Optional: every Role can also be called directly.
_Avoid_: orchestrator (use Lead).

**Product Manager** — the Role that decides *what* and *why*: brief, scope, acceptance criteria. Distinct from the Project Manager (*who, when, in what order*).

**Playbook** — a fixed, named sequence of Roles for a recurring kind of work (e.g. build a feature, launch, audit). Invoked as a command; skips the Lead's routing decision.

**Own product** — software the company builds and markets itself (SaaS, web app, native desktop app or game).

**Client project** — software built for an outside client to their brief, ending in a handoff.

**Product type** — what kind of software is shipped: *web* (SaaS/web app), *desktop* (native app for Windows, Linux, macOS) or *game* (built on a game engine). Applies to both Own products and Client projects.

**Stack pack** — _Retired_: use **Rule pack**. Roles and Practices never assume a language.

**Gate** — a point where the Lead stops and waits for the CEO's approval, asked in a form (AskUserQuestion), as is every other question to the CEO. Three Gates: **Brief** (scope agreed), **Plan** (plan/design agreed), **Ship** (before anything is released or made public).

**Step** — one Role doing one piece of work. Every Step starts with a fresh context and knows only what its incoming Handoff tells it.

**Handoff** — the written output of a Step that the next Step starts from: what was done, decisions made, open issues, what's needed next.

**Company profile** — facts that hold for every McSparrow product: identity, Voice presets, jurisdiction, default license.

**Project profile** — facts about one product: Product type, audience, stack, client (if any), chosen Voice preset, license.

**Voice preset** — one of three named writing voices (*clear*: friendly, no hype; *bold*: playful and punchy; *technical*: precise and formal). Each Project profile picks one.

**Fix round** — a reviewing Role rejects work for a blocking issue and it goes back to the builder. After the Fix-round limit (2 by default, 0–5 in settings) on the same work, the Lead escalates to the CEO. Non-blocking remarks (nits) are recorded, never looped.

**Core** — the minimal part of a product that everything else depends on. Proposed by the Architect, approved by the CEO at the Plan Gate. Nothing enters Core without that approval.

**Module** — a self-contained, pluggable unit of functionality outside Core. A Module talks to Core and to other Modules only through Contracts, never through their internals.

**Contract** — the explicit, agreed interface between Core and a Module or between Modules (what is offered, what is expected). The only allowed coupling. Breaking it is a blocking review issue.

**Persona** — a named, described target user (goals, skill level, devices, abilities) from the Project profile. User-testing Roles act as a Persona.

**Usability finding** — a problem a Persona hits while using the product. Blocking only when an acceptance criterion fails or WCAG 2.2 AA is violated; otherwise a recommendation.

**Asset** — a visual or motion deliverable from an artist Role (logo, icon, illustration, image prompt, animation, game/3D art), delivered with its source and license.

**Art direction** — the product's visual style (mood, palette, references, do/don't), recorded in the Project profile. Every Asset follows it.

**Practice** — a reusable way of working (e.g. test-first development, an OWASP checklist, brand voice). Loaded on demand by whichever Role needs it. Not a job, has no owner.

**Spike** — a throwaway proof, built by an engineer before the Plan Gate to settle a risk the Architect named. Never merged into the product.

**Incident** — a production failure or security event in a shipped product. Handled by `/aico:incident`; ends with a postmortem.

**Lesson** — one line in `.company/lessons.md`, written at the end of a run, that later runs must respect.

**Pentester** — the Role that, on demand and with authorization, attacks the company's own product (local or staging build) like a red team, chains weaknesses and proves findings with safe reproductions (`full` mode allows real exploit chains, still local-only). Reports; never edits code or attacks third-party systems.

**Vulnerability Scanner** — the Role that, on demand, cross-references the product's dependencies and code against published vulnerability databases (NVD/CVE, OSV, GitHub Advisories, vendor advisories, CISA KEV) and reports what is flagged with fixed-in versions. Never edits code.

**Senior Engineer** — the Role that researches sourced best-practice rules for every tool in a product's stack, keeps the Ruleset, maps rules to plan tasks and checks diffs against it. Reports to the Architect, who signs the Ruleset off.

**Ruleset** — a product's binding rules: `.company/standards.md` plus the committed copies of its Rule packs in `.company/standards/`. Security rules are always Must.

**Rule pack** — the rules for one tool and major version (`<tool>@<major>.md`), each with its source URL. Kept in the company library (`~/.mcsparrow/standards/`) and copied into each product that uses it.

**Must / Should / May** — rule tiers. Must: always followed; a break blocks. Should: followed, or a written reason in the Handoff. May: advice.

**Exception** — CEO approval to not follow one Must rule in a stated scope, recorded in the Ruleset with its date.

**Debt** — existing violations of a rule that arrived after the code was written. Listed in the Ruleset; never blocks a run (except an exploitable security Must).

**Handoff Contract** — the machine-readable shape of a Handoff: frontmatter fields (`status`, `round`, `base-commit`, `risk-tier`, `acceptance-ids`, `files-touched`) plus a `contract|spec|security|test` blocking taxonomy, so the Lead routes and resumes from fields rather than prose.

**Top block** — the `aico-top` block of Handoff v1.1 with `status`, `files`, `ac_ids`, `rule_ids`, `risks`, `read_next` and `tokens_used`. Pilot: code-reviewer and compliance only, and only with `pipeline.review_format: pilot` (default `plain`). Their findings are rows `ID | file:line | problem | why | fix` with stable IDs.

**Context cap** — the fixed max context of every Role and tier: 95000, with a hand-over at 85500, passed in each dispatch as `Context cap: 95000 handover 85500`. The old `context_cap` settings are accepted but have no effect. A soft limit.

**Idea flow** — the route of `/aico:idea` and `/aico:bug`: capture, a grill, a reprompt, then the routes A to E, ticket approval and the tickets form F, G, E. Both kinds share one route; the kind decides the build Playbook (`aico:feature` for an idea, `aico:fix` for a bug). The allowed picks come from the `idea-flow` script. Record: `.company/work/<slug>/idea-flow.jsonl`. Contract `idea-flow` v1.1.

**Ticket approval** — the CEO's one-by-one approval of the tickets (tasks of a plan) in the idea flow. An approval counts only for the ticket text it was given for; a ticket changed afterwards is asked again. No Gate reads the record. Record: `.company/work/<slug>/tickets.jsonl`. Contract `ticket-approval` v1.

**Lead Handoff** — the file `.company/work/<slug>/lead-handoff-<n>.md` that a `PreCompact` hook writes from the run's records at a clean point, and a `SessionStart` hook returns after compaction, so the Lead continues without the CEO. Needs `CLAUDE_CODE_AUTO_COMPACT_WINDOW` set to `98500` once. Contract `lead-handoff` v1; ADR 0049.

**Token ledger** — a counts-only record of tokens per Step and per run in `.company/ledger/`, never prompt text. Feeds the cost line at the Ship Gate. Savings come from reading less; no saving percentage is claimed yet.

**Scorecard** — the one line printed after the Ship Gate is approved: time to Ship Gate, CEO wait, spend per shipped AC, Fix rounds, high blockers and Gate rejects, each beside the median of the last 5 shipped runs. Times and counts only; it never blocks a Step or a Gate. Contract `token-ledger` v1.1.

**Stable** — the `stable` branch. It moves only to a release tag (`v<x.y.z>`) that is merged into `main`, through `npm run stable -- <x.y.z>` after the Ship Gate, and it can move back to an earlier tag. Install from it with `#stable` on the marketplace source.

**Tool check** — a rule tagged `check: <tool>`, bound to its rule ID in `.company/checks.json`. It runs before review; a failure is a finding the reviewer confirms before it blocks.

**Rule slice** — the rules mapped to one task, always including every security Must. Builders read them from a per-task file in `rules/` that holds the rule text.

**Findings ledger** — the reviewer's file listing every finding and checked file. Written only near a handover, so a handover mid-review loses nothing.

**Review depth** — how much a review covers, set by the touched paths, not the builder's label. Contract, Core and security paths always get a full review.

**Golden Handoff** — a reference Handoff run under `npm test` as a regression net; its size is the token baseline.

**Digest** — the part of a format 2 brainstorm file that quotes your answers word for word, lists open threads, keeps a dissent line and links each item to its round.

**Crossfire** — in debate mode, the round's sharpest clash. By default it is folded into the next round: the challenged Role answers it in its next ideas pass ("Challenge to you"), with no extra dispatch. The setting `brainstorm.debate` is `crossfire` (default) or `full_pass`, which keeps the live pair (about 50 words each).

**Round input** — the small per-Role file in `.company/brainstorm-input/` that holds what changes each brainstorm round (digest, questions, "Others said" with idea IDs). The Role's dispatch prompt stays constant for the whole run. The script writes the file and removes it at Close.

**Film script** — an optional separate file (`brainstorm.film_script`, off by default) where every line quotes a stored brainstorm reply. No model call.

**Context budget** — no agent (Role or Lead) goes over 95000 tokens of context. A Role at 85500 stops at a clean point and writes a Handoff with `status: handover`; the Lead dispatches a fresh Step of the same Role to continue from its `## Next`. Never consumes a Fix round.

**Risk tier** — `low | medium | high`, set in the Brief and carried in every dispatch; forced high for auth, payments, personal data, migrations or a Contract change. Drives test depth, rule scope and routing. A Role may raise it, never lower it.

**Pre-filter** — a deterministic check run before the Code Reviewer that only appends tagged findings; it never closes a review, never emits `status: done`, and never consumes a Fix round.

**Triage** — the `/aico:triage` Playbook: classifies a request by size, risk and type and recommends the shortest valid route before the Brief Gate; risk always overrides size.

**Triage record** — the proof that the CEO approved a direct route at triage's Brief Gate for one exact request. Triage writes it before a direct hand-over to a gitignored `.company/triage/` folder: a keyed hash of the request (HMAC, keyed by a one-time code; the request is normalized first: NFC, line ends as LF, trailing spaces stripped per line, trimmed, one pair of outer quotes ignored) and the time, never the request text or the code. The code is held only in the session. Valid 30 minutes, usable once. `aico:lead` checks the code from triage's own run once with `run-state.mjs triage check` and never runs `triage issue` itself; it trusts a direct triage line only when that check confirms it. Files with more than one hard link are refused. Contract `run-state` v1.2.

**Brainstorm** — a Playbook where the relevant Roles give ideas, risks and questions on a CEO idea over rounds (modes: ideas, debate, moderated) until the CEO says done. Ends in one of four outcomes: plan and implement, Roadmap, Nice to have, Parked; each outcome but the first has its own `.company/` folder.

**Cooler** — the `/aico:cooler` Playbook: an unmoderated chat between randomly chosen Roles about the project; colleagues walk up and leave as it goes. Recorded in `.company/cooler/` with an Overheard list; never routed or built. Unlike a Brainstorm, nobody moderates and no outcome is chosen.

**Performance budget** — measurable limits in the Project profile (e.g. LCP, bundle size, startup time, memory, frame time) that QA and the Code Reviewer check against.

**Research run** — one `/aico:research` Playbook run: an approved question, the researchers' Handoffs, one report in `.company/research/` and your pick (feature, brainstorm, roadmap or park). Builds nothing; the only commit is the report.

**Feasibility verdict** — the `## Verdict` of a research report: `go`, `go-with-conditions` or `no-go`, with a confidence (high, medium or low) and a reason. It rests only on sourced claims; without them the confidence is low.

**Low-hanging fruit** — the part of a research report that lists quick wins, each with impact (high, medium, low) and effort (S, M, L), sorted by impact over effort.

**aico language** — `aico_language`: the BCP 47 tag of the language aico writes in (Handoff prose, forms, reports, summaries). Set with `/aico:language`, as your default or per project. Distinct from `languages:`, which lists the product's UI locales. Machine-read parts stay English.

**Design skills** — the approved set of UI/UX skills for one product, at most five, in `## Design skills` of `.company/project.md`. Each line has its source, license, vetted and approval dates. Installed only after you approve the exact commands.

**Effort** — how long a Role thinks before acting: `low | medium | high | xhigh | max`. Each Role's default is in its agent file; the CEO can change it in Settings.

**Role name** — the person name a Role shows in cooler chats, brainstorms, Gate summaries and Handoff bylines (e.g. Ava for the architect). Display only: `aico:<role>` IDs, file names and routing never change. Defaults live in `company/names.json`.

**Company type** — the kind of company a project is: `software` (the default, and the only one before this version), `research`, `marketing` or `design`. It sets which Roles and Playbooks the project has and what "ship" means. One per project, set by `/aico:setup` as `company_type:` in `.company/project.md`; switching is not supported. Defined in `company/types/<id>.json`.

**Personality** — a Role's style data: temperament, way of talking and pet topic (short text), plus Intelligence and Creativity (`low | medium | high`). Used only in `/aico:cooler` chats and `/aico:brainstorm` rounds, and passed as quoted data, never as an instruction. It never changes a verdict, a review, a Gate or any other dispatch. Defaults live in `company/personalities.json`; set it in Settings at user or project level.

**Editor** — the Role (Edith) that checks every claim in a report or public text is cited `[S#]` or marked `(unverified)`. It blocks with a `[spec]` finding and never rewrites. Its passing Handoff satisfies the `claims-cited` check.

**Mod** — a small add-on that runs inside Claude Code and shows the CEO something or checks something. There are four: Savvy, Cache Tax, Reflect and Blast Radius. They add no tokens to a prompt, apart from Reflect `model` mode and Blast Radius's refusal reason. Switched in `/aico:settings`.

**Savvy** — the mod that shows the progress of the current run: wave, Step, Gates passed, Fix round and elapsed time.

**Cache Tax** — the mod that shows spend per Step, with cache writes marked `[tax]`, and the cache clock.

**Reflect** — the mod that checks each finished Step and the finished run, and suggests Lessons. Each is `suggested` until the CEO presses Accept; Decline writes nothing.

**Blast Radius** — the mod that checks what a `git commit` touches (Core, Contract or security paths) before it runs, through both the `Bash` and `PowerShell` tools. Each category is `ask` or `warn`. With nobody to ask it refuses; turning it off needs the `security` unlock.

**Run-state** — the small record of a run's wave, Gates and end, written by the Lead through `scripts/run-state.mjs`. Savvy reads it. It never blocks a Step or a Gate.

**Cache clock** — the time when the Lead's prompt cache expires (last Lead request plus its lifetime, measured as 1 hour), shown by Cache Tax. It only shows the time; nothing keeps the cache warm.

**Settings** — the CEO's choices for Role name, model and effort, language and profile, Fix-round limit, dispatch mode, review lanes and Gates, changed on the `/aico:settings` page. Three levels: plugin default, user default (`~/.mcsparrow/config.json`) and project override (`.company/settings.json`); project wins over user, user over plugin.

**Auto Gate** — a Gate set to `auto` in Settings: the Lead writes the Gate summary to the run folder and continues without a form. An auto Ship Gate pushes the branch and opens a PR, and never merges.

**Lock** — a setting that could skip a safety check (auto Ship Gate, auto installs, turning off the security or compliance lane) and starts locked. Unlocks count only from the CEO's user settings; a project can lock again but never unlock, and a broken project settings file keeps its locks.
