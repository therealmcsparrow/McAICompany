# Roles

The company has **32 Role agents**, each a specialist with a fresh context and a narrow job. The Lead dispatches only the Roles a job needs. Reporting lines (who signs off) are in the [hierarchy diagram](../README.md#company-hierarchy); the Lead dispatches every Role regardless.

Each Role runs on a model matched to its work — **Opus** for the roles that reason hardest (architecture, review, security, product strategy), **Sonnet** for most building and testing, **Haiku** for mechanical content work.

## Product
| Role | Model | What it's for |
|---|---|---|
| **product-manager** | opus | Turns a request into a brief: problem, users, scope, acceptance criteria. Decides *what* and *why*, never *how*. |
| **account-manager** | sonnet | Client intake, proposals, estimates, status reports and handoff letters. |

## Market & tech research
| Role | Model | What it's for |
|---|---|---|
| **market-researcher** | sonnet | Researches demand, competitors, target users, pricing signals and EU flags for an idea, from public sources with a URL and date for each claim. |
| **tech-researcher** | opus | Checks feasibility: libraries and APIs, their licenses and maintenance, fit with the repo, effort and risk. Reports facts; never picks the stack. |
| **design-researcher** | opus | Finds and vets UI/UX and design skills that fit your stack, product type, Personas and Art direction, judges the installed ones, and recommends at most 5. Never installs. |

The three researchers run in parallel inside [`/aico:research`](commands.md#aicoresearch). The Product Manager writes the report from their Handoffs. The design-researcher also runs in [`/aico:feature`](commands.md#aicofeature) for UI products whose design skills are missing or stale.

## Engineering
| Role | Model | What it's for |
|---|---|---|
| **architect** (CTO) | opus | Designs *how* a product is built: the Core list, versioned Contracts, the Module map, technology choices, estimates and ADRs. Signs off the Ruleset. |
| **senior-engineer** | opus | Researches sourced best-practice rules for every tool in the stack, keeps the Ruleset, maps rules to plan tasks and checks diffs against them. Security is law. |
| **backend-engineer** | sonnet | Server-side Modules: APIs, services, data and jobs, against the Architect's Contracts, test-first. |
| **frontend-engineer** | sonnet | Web UI Modules that register with the app shell through Contracts — accessible, responsive, test-first. |
| **desktop-engineer** | sonnet | Native Windows/Linux/macOS apps: OS integration, packaging, signing, installers, auto-update. |
| **ai-data-engineer** | sonnet | LLM features, retrieval, data pipelines and analytics as Modules behind Contracts, with evals and privacy in mind. |
| **game-engineer** | sonnet | Game Core and gameplay Modules: engine bootstrap, game loop, systems, within the frame-time budget. |
| **devops** | sonnet | CI/CD, infrastructure, environments, packaging pipelines, deployments and releases. Ships only after the Ship Gate. |

## Design & Art
| Role | Model | What it's for |
|---|---|---|
| **ui-ux-designer** | sonnet | User flows, wireframes, screen states, design tokens and the design system. |
| **brand-artist** | sonnet | Art direction, logos, icon sets, per-OS app icons, illustrations, social/OG/store images as editable SVG or code. |
| **motion-artist** | sonnet | Micro-interactions, transitions, loading and empty states, Lottie/CSS animations, demo storyboards. |
| **game-artist** | sonnet | Sprites, tilesets, sprite sheets, 3D asset briefs, shaders and VFX, with engine-ready specs and Blender exports. |
| **prompt-artist** | haiku | Reproducible prompts and art direction for image models, for you to run. |

## Quality & Security
| Role | Model | What it's for |
|---|---|---|
| **code-reviewer** | opus | Reviews the branch diff for spec match, correctness, standards and Core/Module/Contract rules. Never edits code. |
| **qa** | sonnet | Reproduces bugs, turns acceptance criteria into tests, writes contract tests per Module, runs the suite. Edits test files only. |
| **security** | opus | Audits code, dependencies and configuration for vulnerabilities, auth flaws, secrets and data exposure. Never edits code. |
| **pentester** | opus | *On demand.* Authorized red team against your own local/staging build — see below. Never edits code. |
| **vuln-scanner** | opus | *On demand.* Cross-references dependencies and code against published vulnerability databases — see below. Never edits code. |

## User research & testing
| Role | Model | What it's for |
|---|---|---|
| **ux-researcher** | sonnet | Plans usability tests with real people (scripts, screeners, consent) and synthesizes feedback into findings and Personas. |
| **persona-tester** | sonnet | Walks through designs, prototypes, specs or copy as a given Persona, before anything is built. |
| **hands-on-tester** | sonnet | Uses the running app for real through browser/computer-use tools and reports usability findings with screenshots. |
| **accessibility-tester** | sonnet | Tests against WCAG 2.2 AA: keyboard-only, screen reader, zoom, contrast and reduced-motion runs. |

## Content & Growth
| Role | Model | What it's for |
|---|---|---|
| **writer** | haiku | User docs, getting-started guides, UX copy, release notes, READMEs, client handoff docs. |
| **marketer** | sonnet | Positioning, messaging, landing and store-page copy, SEO, launch plans, announcement posts. |
| **localizer** | haiku | Translates resource files into each supported language. Edits only string resource files. |

## Support & Legal
| Role | Model | What it's for |
|---|---|---|
| **support** | sonnet | Turns user reports and tickets into triaged, de-duplicated work with draft replies. |
| **legal** | sonnet | Privacy policies, terms, GDPR checks, cookie/consent, marketing-claim checks, dependency license audits. |

## Who may edit code

Most Roles produce plans, designs, reviews or reports. Only the engineers write product code. **Code-reviewer, security, pentester, vuln-scanner, senior-engineer, legal, product-manager, account-manager, support and the three researchers never edit source.** Researchers write only their own Handoff and never install anything; any install happens after your approval in a form. The localizer edits only string resource files; QA edits only tests; the architect writes only ADRs and Contract definitions; the senior-engineer writes only rule packs and the Ruleset. Testers never edit.

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
