# Roles

The company has **36 Role agents**, each a specialist with a fresh context and a narrow job. The Lead dispatches only the Roles a job needs. Reporting lines (who signs off) are in the [hierarchy diagram](../README.md#company-hierarchy); the Lead dispatches every Role regardless.

Each Role runs on a model and an effort level matched to its work. The model is how capable the Role is: **Opus** for the Roles that reason hardest (architecture, review, security, product strategy), **Sonnet** for most building, testing and writing, **Haiku** for mechanical content work. The effort is how much thinking it does before it answers: **high** for the architect, code-reviewer, security and pentester; **low** for writing, art, lookup and support Roles; **medium** for the rest.

Every Role has a person name for display (change them in `/aico:settings`). You can also ask for a Role by name; the Lead routes it. The default names are the ones in the Name column of the tables below, for example Ava for the architect, Wen for the writer and Edith for the editor. Names are unique across Roles, ignoring case. Each Role also has a [personality](concepts.md#personalities) that colours how it talks in cooler chats and brainstorms, and nowhere else.

Which Roles a project has depends on its [company type](concepts.md#company-types). A software company has 35 of the 36; the editor belongs to the research, marketing and design types. A Role outside your type is not dispatched.

## Model floor and protected Roles
The tech-researcher runs on Sonnet; every other Role keeps the model it had in v0.16.0, which is its **floor**. On a high-risk run a Role is never dispatched below its floor. Six Roles are **protected** and hold their floor at every risk tier, whatever you set: architect, code-reviewer, fresh-reviewer, pentester, security and vuln-scanner. Details and sources are in [Which model a Role runs on](concepts.md#which-model-a-role-runs-on).

**Rollback, one line per Role.**
- One Role: in `/aico:settings`, set `roles.<role>.model` to the model you want, for example `opus` for the tech-researcher. A protected Role cannot be set below its floor.
- Everything: install the `stable` tag of v0.16 (see [Getting started](getting-started.md)).

## Product
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **product-manager** | opus | medium | Nora | Turns a request into a brief: problem, users, scope, acceptance criteria. Decides *what* and *why*, never *how*. |
| **reprompter** | sonnet | medium | Lynn | Turns a rough prompt into a complete one (goal, context, inputs, constraints, output format, done-check). Asks only when a gap would change the result; never runs the prompt. Use it through `/aico:reprompt`. |
| **account-manager** | sonnet | low | Carmen | Client intake, proposals, estimates, status reports and handoff letters. |

## Market & tech research
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **market-researcher** | sonnet | low | Mateo | Researches demand, competitors, target users, pricing signals and EU flags for an idea, from public sources with a URL and date for each claim. |
| **tech-researcher** | sonnet | medium | Tariq | Checks feasibility: libraries and APIs, their licenses and maintenance, fit with the repo, effort and risk. Reports facts; never picks the stack. |
| **design-researcher** | sonnet | medium | Daria | Finds and vets UI/UX and design skills that fit your stack, product type, Personas and Art direction, judges the installed ones, and recommends at most 5. Never installs. |
| **skill-researcher** | sonnet | medium | Selin | Finds and vets third-party skills for your stack, product type, company type or design, and recommends at most 5. Has no Bash: the Lead scans every pick in a quarantine before you see it. Never adds a skill; the Lead does that after your approval, pinned to the scanned commit. |

The first three researchers run in parallel inside [`/aico:research`](commands.md#aicoresearch). The Product Manager writes the report from their Handoffs. The design-researcher also runs in [`/aico:feature`](commands.md#aicofeature) for UI products whose design skills are missing or stale. The skill-researcher runs when you ask for skill picks.

## Engineering
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **architect** (CTO) | opus | high | Ava | Designs *how* a product is built: the Core list, versioned Contracts, the Module map, technology choices, estimates and ADRs. Signs off the Ruleset. |
| **senior-engineer** | opus | medium | Erik | Researches sourced best-practice rules for every tool in the stack, keeps the Ruleset, maps rules to plan tasks and checks diffs against them. Security is law. |
| **backend-engineer** | sonnet | medium | Ben | Server-side Modules: APIs, services, data and jobs, against the Architect's Contracts, test-first. |
| **frontend-engineer** | sonnet | medium | Freya | Web UI Modules that register with the app shell through Contracts — accessible, responsive, test-first. |
| **desktop-engineer** | sonnet | medium | Kenji | Native Windows/Linux/macOS apps: OS integration, packaging, signing, installers, auto-update. |
| **ai-data-engineer** | sonnet | medium | Dev | LLM features, retrieval, data pipelines and analytics as Modules behind Contracts, with evals and privacy in mind. |
| **game-engineer** | sonnet | medium | Hugo | Game Core and gameplay Modules: engine bootstrap, game loop, systems, within the frame-time budget. |
| **devops** | sonnet | medium | Omar | CI/CD, infrastructure, environments, packaging pipelines, deployments and releases. Ships only after the Ship Gate. |

## Design & Art
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **ui-ux-designer** | sonnet | medium | Yuki | User flows, wireframes, screen states, design tokens and the design system. |
| **brand-artist** | sonnet | low | Bianca | Art direction, logos, icon sets, per-OS app icons, illustrations, social/OG/store images as editable SVG or code. |
| **motion-artist** | sonnet | low | Milo | Micro-interactions, transitions, loading and empty states, Lottie/CSS animations, demo storyboards. |
| **game-artist** | sonnet | low | Gabriel | Sprites, tilesets, sprite sheets, 3D asset briefs, shaders and VFX, with engine-ready specs and Blender exports. |
| **prompt-artist** | haiku | low | Iris | Reproducible prompts and art direction for image models, for you to run. |

## Quality & Security
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **code-reviewer** | opus | high | Rui | Reviews the branch diff for spec match, correctness, standards and Core/Module/Contract rules. Never edits code. |
| **fresh-reviewer** | opus | high | Fenna | Reviews a diff with a clean context and no run history. Protected: never runs below opus. Never edits code. |
| **qa** | sonnet | medium | Quinn | Reproduces bugs, turns acceptance criteria into tests, writes contract tests per Module, runs the suite. Edits test files only. |
| **security** | opus | high | Sam | Audits code, dependencies and configuration for vulnerabilities, auth flaws, secrets and data exposure. Never edits code. |
| **pentester** | opus | high | Pavel | *On demand.* Authorized red team against your own local/staging build — see below. Never edits code. |
| **vuln-scanner** | sonnet | low | Viktor | *On demand.* Cross-references dependencies and code against published vulnerability databases — see below. Never edits code. |

## User research & testing
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **ux-researcher** | sonnet | low | Uma | Plans usability tests with real people (scripts, screeners, consent) and synthesizes feedback into findings and Personas. |
| **persona-tester** | sonnet | low | Priya | Walks through designs, prototypes, specs or copy as a given Persona, before anything is built. |
| **hands-on-tester** | sonnet | medium | Hana | Uses the running app for real through browser/computer-use tools and reports usability findings with screenshots. |
| **accessibility-tester** | sonnet | medium | Amara | Tests against WCAG 2.2 AA: keyboard-only, screen reader, zoom, contrast and reduced-motion runs. |

## Content & Growth
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **writer** | sonnet | low | Wen | User docs, getting-started guides, UX copy, release notes, READMEs, client handoff docs. |
| **marketer** | sonnet | low | Maya | Positioning, messaging, landing and store-page copy, SEO, launch plans, announcement posts. |
| **localizer** | haiku | low | Lucía | Translates resource files into each supported language. Edits only string resource files. |
| **editor** | sonnet | medium | Edith | Checks that every claim in a report or public text is cited `[S#]` or marked `(unverified)`, and flags unclear or inconsistent wording. Blocks with a `[spec]` finding; never rewrites. Its passing Handoff is what satisfies the `claims-cited` check at the Ship Gate. |

## Support & Legal
| Role | Model | Effort | Name | What it's for |
|---|---|---|---|---|
| **support** | sonnet | low | Sofia | Turns user reports and tickets into triaged, de-duplicated work with draft replies. |
| **legal** | sonnet | medium | Leila | Privacy policies, terms, GDPR checks, cookie/consent, marketing-claim checks, dependency license audits. |

## Who may edit code

Most Roles produce plans, designs, reviews or reports. Only the engineers write product code. **Code-reviewer, security, pentester, vuln-scanner, senior-engineer, legal, product-manager, account-manager, support and the four researchers never edit source.** Researchers write only their own Handoff and never install anything; any install happens after your approval in a form. The editor has no Bash and no web access, and writes only its own Handoff. The localizer edits only string resource files; QA edits only tests; the architect writes only ADRs and Contract definitions; the senior-engineer writes only rule packs and the Ruleset. Testers never edit.

## Review Roles and the Handoff block
The **code-reviewer** and the **senior-engineer** (compliance) are the pilot for [Handoff v1.1](concepts.md#the-handoff-contract). By default (`pipeline.review_format: plain`) they write ordinary findings. With `pilot` set in [settings](concepts.md#settings), they write a top block and findings as `ID | file:line | problem | why | fix` rows, and keep a findings ledger so a handover mid-review loses nothing. With either value they confirm tool-check failures before those block, and the reviewer's depth follows the touched paths. All other Roles write Handoffs as before. In a brainstorm, a Role may skip a round, and the Architect adds an S/M/L estimate.

## The two on-demand security Roles

These never run in the default build, audit or maintain flows — you call them deliberately.

### pentester
An **authorized** red-team tester. Its rules of engagement are law and are never relaxed:

- Targets **only the company's own product**, on a **local or staging build** — never a third-party system, never production unless you give explicit authorization naming the target.
- **Default — prove, don't harm:** each finding is demonstrated with the smallest safe reproduction (reading a planted canary file, a harmless marker). No destructive payloads, no data exfiltration, no persistence.
- **`full` mode** (only when you pass `full`): real end-to-end exploit chains to show maximum impact — still local/staging only, still no real user data, and it cleans up everything it drops.
- An exploitable path in production-facing code is flagged for `/aico:incident`.

Run it with [`/aico:pentest`](commands.md#aicopentest) or by asking for it directly.

### vuln-scanner
Reports which of your actual dependencies and code are flagged on **published vulnerability databases** — NVD/CVE, OSV, GitHub Advisories, the ecosystem's advisory DB, vendor advisories and CISA KEV. It uses primary sources only (never blogs or AI summaries), matches each advisory to your installed version and range, and records a source URL for every finding. It never changes your dependency tree.

- **Critical/High, or known-exploited (KEV):** reported for you to act on; a KEV/exploited hit is Blocking and suggests `/aico:incident`.
- **Medium/Low:** collected into a ready **upgrade set** of safe fixed-in bumps you can apply in one `/aico:maintain` run.

Run it with [`/aico:vulnscan`](commands.md#aicovulnscan) or by asking for it directly.
