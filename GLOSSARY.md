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

**Product type** — what kind of software is shipped: *web* (SaaS/web app) or *desktop* (native app for Windows, Linux, macOS). Applies to both Own products and Client projects.

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

**Practice** — a reusable way of working (e.g. test-first development, an OWASP checklist, brand voice). Loaded on demand by whichever Role needs it. Not a job, has no owner.
