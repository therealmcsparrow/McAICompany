# Roles

## In short
The company has **36 Role agents**. A Role is a specialist with a fresh context and a narrow job, such as the architect, the writer or the security tester. The Lead (the Project Manager who runs your job) sends only the Roles a job needs.

Each Role has a person name for display, for example Ava for the architect and Wen for the writer. You can change the names in `/aico:settings`, and you can ask for a Role by name; the Lead routes it. Each Role also has a model (how capable it is) and an effort level (how much it thinks before it answers). The tables below list both, and each Role has its own page with the details.

## How it works
1. You start a job. The Lead picks the Roles that job needs from the tables below.
2. The Lead dispatches each Role as its own Step, with a Goal and the Handoffs it may read.
3. The Role does its narrow job and writes one Handoff file.
4. The next Step reads that Handoff. Gates (your approval points) sit between the Steps; see [Gates](../concepts/gates.md).
5. A Role outside your [company type](../concepts/company-types.md) is not dispatched.

## Technical details
The company has **36 Role agents**, each a specialist with a fresh context and a narrow job. The Lead dispatches only the Roles a job needs. Reporting lines (who signs off) are in the [hierarchy diagram](../../README.md#company-hierarchy); the Lead dispatches every Role regardless.

Each Role runs on a model and an effort level matched to its work. The model is how capable the Role is: **Opus** for the Roles that reason hardest (architecture, review, security, product strategy), **Sonnet** for most building, testing and writing, **Haiku** for mechanical content work. The effort is how much thinking it does before it answers: **high** for the architect, code-reviewer, security and pentester; **low** for writing, art, lookup and support Roles; **medium** for the rest.

Every Role has a person name for display (change them in `/aico:settings`). You can also ask for a Role by name; the Lead routes it. The default names are the ones in the Name column of the tables below, for example Ava for the architect, Wen for the writer and Edith for the editor. Names are unique across Roles, ignoring case. Each Role also has a [personality](../concepts/personalities.md) that colours how it talks in cooler chats and brainstorms, and nowhere else.

Which Roles a project has depends on its [company type](../concepts/company-types.md). A software company has 35 of the 36; the editor belongs to the research, marketing and design types. A Role outside your type is not dispatched.

### Model floor and protected Roles
The tech-researcher runs on Sonnet; every other Role keeps the model it had in v0.16.0, which is its **floor**. On a high-risk run a Role is never dispatched below its floor. Six Roles are **protected** and hold their floor at every risk tier, whatever you set: architect, code-reviewer, fresh-reviewer, pentester, security and vuln-scanner. Details and sources are in [Which model a Role runs on](../concepts/model-choice.md).

**Rollback, one line per Role.**
- One Role: in `/aico:settings`, set `roles.<role>.model` to the model you want, for example `opus` for the tech-researcher. A protected Role cannot be set below its floor.
- Everything: install the `stable` tag of v0.16 (see [Getting started](../start/getting-started.md)).

### Product
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **product-manager** | opus | medium | Nora | Turns a request into a brief: problem, users, scope, acceptance criteria. Decides *what* and *why*, never *how*. [Page](product-manager.md) |
| **reprompter** | sonnet | medium | Lynn | Turns a rough prompt into a complete one (goal, context, inputs, constraints, output format, done-check). Asks only when a gap would change the result; never runs the prompt. Use it through `/aico:reprompt`. [Page](reprompter.md) |
| **account-manager** | sonnet | low | Carmen | Client intake, proposals, estimates, status reports and handoff letters. [Page](account-manager.md) |

### Market & tech research
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **market-researcher** | sonnet | low | Mateo | Researches demand, competitors, target users, pricing signals and EU flags for an idea, from public sources with a URL and date for each claim. [Page](market-researcher.md) |
| **tech-researcher** | sonnet | medium | Tariq | Checks feasibility: libraries and APIs, their licenses and maintenance, fit with the repo, effort and risk. Reports facts; never picks the stack. [Page](tech-researcher.md) |
| **design-researcher** | sonnet | medium | Daria | Finds and vets UI/UX and design skills that fit your stack, product type, Personas and Art direction, judges the installed ones, and recommends at most 5. Never installs. [Page](design-researcher.md) |
| **skill-researcher** | sonnet | medium | Selin | Finds and vets third-party skills for your stack, product type, company type or design, and recommends at most 5. Has no Bash: the Lead scans every pick in a quarantine before you see it. Never adds a skill; the Lead does that after your approval, pinned to the scanned commit. [Page](skill-researcher.md) |

The first three researchers run in parallel inside [`/aico:research`](../commands/research.md). The Product Manager writes the report from their Handoffs. The design-researcher also runs in [`/aico:feature`](../commands/feature.md) for UI products whose design skill selections are missing or older than 180 days. The skill-researcher runs when you ask for skill picks.

### Engineering
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **architect** (CTO) | opus | high | Ava | Designs *how* a product is built: the Core list, versioned Contracts, the Module map, technology choices, estimates and ADRs. Signs off the Ruleset. [Page](architect.md) |
| **senior-engineer** | opus | medium | Erik | Researches sourced best-practice rules for every tool in the stack, keeps the Ruleset, maps rules to plan tasks and checks diffs against them. Security is law. [Page](senior-engineer.md) |
| **backend-engineer** | sonnet | medium | Ben | Server-side Modules: APIs, services, data and jobs, against the Architect's Contracts, test-first. [Page](backend-engineer.md) |
| **frontend-engineer** | sonnet | medium | Freya | Web UI Modules that register with the app shell through Contracts — accessible, responsive, test-first. [Page](frontend-engineer.md) |
| **desktop-engineer** | sonnet | medium | Kenji | Native Windows/Linux/macOS apps: OS integration, packaging, signing, installers, auto-update. [Page](desktop-engineer.md) |
| **ai-data-engineer** | sonnet | medium | Dev | LLM features, retrieval, data pipelines and analytics as Modules behind Contracts, with evals and privacy in mind. [Page](ai-data-engineer.md) |
| **game-engineer** | sonnet | medium | Hugo | Game Core and gameplay Modules: engine bootstrap, game loop, systems, within the frame-time budget. [Page](game-engineer.md) |
| **devops** | sonnet | medium | Omar | CI/CD, infrastructure, environments, packaging pipelines, deployments and releases. Ships only after the Ship Gate. [Page](devops.md) |

### Design & Art
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **ui-ux-designer** | sonnet | medium | Yuki | User flows, wireframes, screen states, design tokens and the design system. [Page](ui-ux-designer.md) |
| **brand-artist** | sonnet | low | Bianca | Art direction, logos, icon sets, per-OS app icons, illustrations, social/OG/store images as editable SVG or code. [Page](brand-artist.md) |
| **motion-artist** | sonnet | low | Milo | Micro-interactions, transitions, loading and empty states, Lottie/CSS animations, demo storyboards. [Page](motion-artist.md) |
| **game-artist** | sonnet | low | Gabriel | Sprites, tilesets, sprite sheets, 3D asset briefs, shaders and VFX, with engine-ready specs and Blender exports. [Page](game-artist.md) |
| **prompt-artist** | haiku | low | Iris | Reproducible prompts and art direction for image models, for you to run. [Page](prompt-artist.md) |

### Quality & Security
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **code-reviewer** | opus | high | Rui | Reviews the branch diff for spec match, correctness, standards and Core/Module/Contract rules. Never edits code. [Page](code-reviewer.md) |
| **fresh-reviewer** | opus | high | Fenna | Reads a plan before the builders start (feature and fix have no Plan Gate), and at high risk with the second reviewer on a diff, as a newcomer: it never reads the brief or the builders' notes, writes the plan in its own words first, then lists what the text does not make clear. Protected: never runs below opus. Never edits code. See [The fresh reviewer](../concepts/review.md). [Page](fresh-reviewer.md) |
| **qa** | sonnet | medium | Quinn | Reproduces bugs, turns acceptance criteria into tests, writes contract tests per Module, runs the suite. Edits test files only. [Page](qa.md) |
| **security** | opus | high | Sam | Audits code, dependencies and configuration for vulnerabilities, auth flaws, secrets and data exposure. Never edits code. [Page](security.md) |
| **pentester** | opus | high | Pavel | *On demand.* Authorized red team against your own local/staging build — see below. Never edits code. [Page](pentester.md) |
| **vuln-scanner** | sonnet | low | Viktor | *On demand.* Cross-references dependencies and code against published vulnerability databases — see below. Never edits code. [Page](vuln-scanner.md) |

### User research & testing
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **ux-researcher** | sonnet | low | Uma | Plans usability tests with real people (scripts, screeners, consent) and synthesizes feedback into findings and Personas. [Page](ux-researcher.md) |
| **persona-tester** | sonnet | low | Priya | Walks through designs, prototypes, specs or copy as a given Persona, before anything is built. [Page](persona-tester.md) |
| **hands-on-tester** | sonnet | medium | Hana | Uses the running app for real through browser/computer-use tools and reports usability findings with screenshots. [Page](hands-on-tester.md) |
| **accessibility-tester** | sonnet | medium | Amara | Tests against WCAG 2.2 AA: keyboard-only, screen reader, zoom, contrast and reduced-motion runs. [Page](accessibility-tester.md) |

### Content & Growth
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **writer** | sonnet | low | Wen | User docs, getting-started guides, UX copy, release notes, READMEs, client handoff docs. [Page](writer.md) |
| **marketer** | sonnet | low | Maya | Positioning, messaging, landing and store-page copy, SEO, launch plans, announcement posts. [Page](marketer.md) |
| **localizer** | haiku | low | Lucía | Translates resource files into each supported language. Edits only string resource files. [Page](localizer.md) |
| **editor** | sonnet | medium | Edith | Checks that every claim in a report or public text is cited `[S#]` or marked `(unverified)`, and flags unclear or inconsistent wording. Blocks with a `[spec]` finding; never rewrites. Its passing Handoff is what satisfies the `claims-cited` check at the Ship Gate. [Page](editor.md) |

### Support & Legal
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **support** | sonnet | low | Sofia | Turns user reports and tickets into triaged, de-duplicated work with draft replies. [Page](support.md) |
| **legal** | sonnet | medium | Leila | Privacy policies, terms, GDPR checks, cookie/consent, marketing-claim checks, dependency license audits. [Page](legal.md) |

### Who may edit code

Most Roles produce plans, designs, reviews or reports. Only the engineers write product code. **Code-reviewer, fresh-reviewer, security, pentester, vuln-scanner, senior-engineer, legal, product-manager, account-manager, support and the four researchers never edit source.** Researchers write only their own Handoff and never install anything; any install happens after your approval in a form. The editor has no Bash and no web access, and writes only its own Handoff. The localizer edits only string resource files; QA edits only tests; the architect writes only ADRs and Contract definitions; the senior-engineer writes only rule packs and the Ruleset. Testers never edit.

### Review Roles and the Handoff block
The **code-reviewer** and the **senior-engineer** (compliance) are the pilot for [Handoff v1.1](../concepts/handoffs.md). By default (`pipeline.review_format: plain`) they write ordinary findings. With `pilot` set in [settings](../concepts/settings-and-locks.md), they write a top block and findings as `ID | file:line | problem | why | fix` rows, and keep a findings ledger so a handover mid-review loses nothing. With either value they confirm tool-check failures before those block, and the reviewer's depth follows the touched paths. All other Roles write Handoffs as before. In a brainstorm, a Role may skip a round, and the Architect adds an S/M/L estimate.

### The two on-demand security Roles
The pentester and the vuln-scanner never run in the default build, audit or maintain flows. You call them deliberately: [pentester](pentester.md) with [`/aico:pentest`](../commands/pentest.md), [vuln-scanner](vuln-scanner.md) with [`/aico:vulnscan`](../commands/vulnscan.md).
