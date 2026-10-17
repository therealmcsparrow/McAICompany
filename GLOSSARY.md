# Glossary

**Skillset** — the whole AI-company package, delivered as one installable Claude Code plugin.

**Role** — a job in the company (e.g. Backend Engineer, Security Engineer). Works in its own isolated context and is called in when its expertise is needed. A Role *uses* Practices; it does not contain them.

**CEO** — the human user. Not a Role. Has the final say and approves work at Gates.

**Lead** — the single front door, played by the **Project Manager** Role. Takes any request, decides which Roles are needed, sequences them, and tracks status. Optional: every Role can also be called directly.
_Avoid_: orchestrator (use Lead).

**Product Manager** — the Role that decides *what* and *why*: brief, scope, acceptance criteria. Distinct from the Project Manager (*who, when, in what order*).

**Playbook** — a fixed, named sequence of Roles for a recurring kind of work (e.g. build a feature, launch, audit). Invoked as a command; skips the Lead's routing decision.

**Own product** — software the company builds and markets itself (SaaS, web app, or native desktop app).

**Client project** — software built for an outside client to their brief, ending in a handoff.

**Product type** — what kind of software is shipped: *web* (SaaS/web app), *desktop* (native app for Windows, Linux, macOS) or *game* (built on a game engine). Applies to both Own products and Client projects.

**Stack pack** — optional, stack-specific guidance (e.g. Rust, Go, React, PHP) read only when the current project uses that stack. Roles and Practices never assume a language.

**Gate** — a point where the Lead stops and waits for the CEO's approval. Three Gates: **Brief** (scope agreed), **Plan** (plan/design agreed), **Ship** (before anything is released or made public).

**Step** — one Role doing one piece of work. Every Step starts with a fresh context and knows only what its incoming Handoff tells it.

**Handoff** — the written output of a Step that the next Step starts from: what was done, decisions made, open issues, what's needed next.

**Company profile** — facts that hold for every McSparrow product: identity, Voice presets, jurisdiction, default license.

**Project profile** — facts about one product: Product type, audience, stack, client (if any), chosen Voice preset, license.

**Voice preset** — one of three named writing voices (*clear*: friendly, no hype; *bold*: playful and punchy; *technical*: precise and formal). Each Project profile picks one.

**Fix round** — a reviewing Role rejects work for a blocking issue and it goes back to the builder. After two Fix rounds on the same work, the Lead escalates to the CEO. Non-blocking remarks (nits) are recorded, never looped.

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

**Performance budget** — measurable limits in the Project profile (e.g. LCP, bundle size, startup time, memory, frame time) that QA and the Code Reviewer check against.
