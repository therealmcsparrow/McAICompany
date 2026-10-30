# Commands

## In short
Every command is a **Playbook**: a fixed, named sequence of Roles for a recurring kind of work. Type it in Claude Code with the plugin installed. If you're not sure which fits, use [`/aico:lead`](lead.md) (or [`/aico:triage`](triage.md)) and let the company choose.

This page lists every command once. Start here, find the command for your job in the route table, then open its page. Each page says what the command does, when to reach for it, how it runs (Gates marked), what you get, and an example.

## How it works
1. Find your job in the route table below.
2. Open the page of that command and read what it does and what you get.
3. Type the command in Claude Code. Arguments in `<angle brackets>` are required; `[square brackets]` are optional.
4. Answer the forms and Gates the company shows you. At each Gate you Approve, Change or Stop.

### Words used on this page
**Words used on this page.**
- **Playbook**: a command, a fixed list of steps for one kind of work.
- **Role**: one member of the company, such as the Architect or the Writer. A Role does one step.
- **Lead**: the Role that talks to you in the main session and runs the other Roles.
- **Gate**: a point where the company stops and asks you to Approve, Change or Stop.
- **Handoff**: the one short file a Role writes at the end of its step, so the next Role knows what happened.
- **Slug**: the short task name a run picks, used as a folder name.
- **Context cap**: how much text a Role may keep in its head at once. It is fixed at 95000 tokens for every Role, and a Role hands over to a fresh one at 85500.
- **Core and Contract**: the Core is the small base of a product; a Contract is the written rule for how two parts of it talk to each other.
- **Ticket**: one small task cut from a spec, with a Role, the files it touches and what it depends on.

### Route table
**Route table.** The same list as the groups under Technical details, in words.

| You have | Start with | What you get |
| --- | --- | --- |
| Any request, or you are unsure | `/aico:lead` | The company picks the route |
| A rough idea you want guided to a build | `/aico:idea` | Grill, route pick, tickets, build |
| A bug report you want guided to a fix | `/aico:bug` | The same route, ending in a fix |
| An idea to question first | `/aico:grilling`, `/aico:grill-me`, `/aico:grill-with-docs` or `/aico:grill` | A `grill.md` of decisions |
| A feature to build | `/aico:feature` | Shipped code on a branch |
| A bug to fix | `/aico:fix` | A fix and a regression test |
| Something to look into, nothing built | `/aico:audit`, `/aico:research`, `/aico:feedback` and others under Assess | A report |

**What each route does, in words.**
- `/aico:idea` and `/aico:bug` run one guided route from your text to a build. See [idea](idea.md) and [bug](bug.md).
- The four grill commands interview you about an idea and build nothing. They differ in where answers come from.
- `/aico:feature` and `/aico:fix` build. Both keep only the Ship Gate: no Brief Gate and no Plan Gate.
- Everything under Assess reads and reports, and changes no code.

## Technical details

### Conventions
Most commands run through the shared pipeline, so a few conventions hold everywhere:

- **Gates** are where the company stops for your approval — **Brief** (scope), **Plan** (design), **Ship** (before anything leaves the repo). At each you Approve, Change or Stop. A Playbook only skips a Gate if its own description says so. `/aico:feature` and `/aico:fix` have no Brief Gate and no Plan Gate in any run: they keep only the Ship Gate, and what those two Gates showed goes into the Ship Gate summary. A decision that used to wait for such a Gate is asked as one plain form when it comes up. See [Gates](../concepts/gates.md).
- **Work lands under `.company/`** in your repo: the brief, designs, reviews, reports and the per-step Handoff files. `<slug>` is the short task name the run picks.
- **Nothing is pushed, merged, deployed or sent** before the Ship Gate.
- **Read-only** commands (audit, feedback, usability-test, pentest, vulnscan, skillspector, research) change no code — they end in a report you act on. Brainstorm and cooler change no code either; help and version only answer in the terminal.

**Company type.** Each project has one [company type](../concepts/company-types.md): `software` (the default when nothing is set), `research`, `marketing` or `design`. The type decides which commands and Roles the project has. `/aico:help` lists only the commands of your type. A command outside it stops with "not part of your `<type>` company" and the list of allowed ones. The commands that every type has: `help`, `version`, `language`, `settings`, `setup`, `lead`, `triage`, `reprompt` and `skillspector`, so every type has the reprompter. `brainstorm`, `cooler`, `research`, `client` and `feedback` are in all four types. `grill` is in all four types; its last step depends on the type. So are `idea`, `grilling`, `grill-me` and `grill-with-docs`. Only the software company has `bug`, `feature`, `fix`, `refactor`, `incident`, `audit`, `pentest`, `vulnscan`, `usability-test`, `maintain`, `standards`, `launch`, `to-spec` and `to-tickets`. The new Playbooks `report`, `campaign`, `content` and `design` are described under [Other company types](#other-company-types). The shared commands hand a finished idea over to the main work of your type, after your pick: `/aico:feature` or `/aico:fix` in a software company, `/aico:report`, `/aico:content` or `/aico:campaign`, `/aico:design` in the others. The type check prints readable lines (the [type lines](../concepts/company-types.md)), and a refusal names what was wrong, such as the unknown command or the line number in `.company/project.md`.

**Help in the terminal.** `/aico:help` lists every command; `/aico:help <command>` explains one command's options and what it does, without running it. Every Playbook also answers `/aico:<command> help` (or `--help`) from its own page in this folder, so each page is what that command tells you.

**Hand-over between commands.** A few commands end with a choice that starts another command: `lead`, `triage`, `brainstorm`, `research`, `refactor`, `grill`, `grilling`, `grill-me` and `grill-with-docs`. The grill commands hand over only to `/aico:feature` and, for `/aico:to-spec`, show you the command to type. `idea` and `bug` start the build step themselves after your pick of F (see their pages). After you pick, the next command starts by itself, with your pick as its argument. If it cannot start, you are shown the exact command to type, and the run stops there. A command never starts another one on its own, and never because a file, a report or a web page asks for it. Only your own request or your choice at a form or Gate starts one. `incident` does not hand over: it ends after the mitigation, the reports and the postmortem, and tells you to run `/aico:fix` yourself.

**Commands only you start.** Ten commands are never started by another command or by the Lead: `help`, `version`, `language`, `settings`, `setup`, `skillspector`, `pentest`, `grill`, `to-spec` and `to-tickets`. The first seven change your configuration, install software or attack a target. The last three run before any build, so they run only on your own command. Five newer commands follow the same rule: `idea`, `bug`, `grilling`, `grill-me` and `grill-with-docs`. You type them yourself. When a run needs one, it tells you the command and waits. For `pentest` it gives you `/aico:pentest <target>`.

**Privacy of drafts.** `grill.md`, the `input-*.md` copies a draft command makes and the one-shot argument file may hold what you type. The drafts live in `.company/work/<slug>/` and the argument file is `.company/draft-input-arg-<for>.txt`, both on your machine. aico never commits them. They stay out of git only if your product ignores `.company/`; add that line to your `.gitignore` yourself, because aico does not set it up. The AI model that runs the command reads their text, and `grill` may run web searches built from your idea; the web search recipients are listed under "Where your text goes". They are archived, not deleted (GDPR Art. 5(1)(c) and (e)). If a person asks for erasure of their data, that request overrides the archive rule; the CEO decides. The argument file is removed as soon as the command has read it.

**Where your text goes.** Four places, and no others:
- The Claude model you configured reads your idea or bug text, the grill answers, the tickets and the Lead Handoff text.
- The web search tools (WebSearch, WebFetch) run in grilling lookups and in research, and in the Water cooler and Brainstorm routes when a Role that holds them (market-researcher, tech-researcher, design-researcher, skill-researcher, senior-engineer or vuln-scanner) joins; those two routes do not forbid it, and a request can carry words from the idea. No other recipient. `/aico:grill-me` never searches, and `/aico:grill-with-docs` never searches the web.
- Local files on your machine: `.company/work/<slug>/` (records and copies), `.company/draft-input-arg-<for>.txt`, `.company/ideas/<name>/` and `.company/roadmap/`. aico writes no ignore rule; they stay out of git only if your product ignores `.company/`.
- The hand-over hooks read token counts from the local Claude Code transcript. They store none of its text.

Nothing is pushed or published by these commands.

**Hand-over of the Lead.** A long run can fill the Lead's context. A PreCompact hook writes the Lead Handoff file, `.company/work/<slug>/lead-handoff-<n>.md`, from the run records; it reads token counts from the local transcript and stores none of its text. A SessionStart hook with source `compact` injects the newest one after compaction. There is no PostToolUse hook. It needs `CLAUDE_CODE_AUTO_COMPACT_WINDOW` set to `98500` in the `env` block of your user settings; a plugin cannot set it. Without it the Lead hands over only at Claude Code's default point. See [One-time setup](../start/setup.md).

### Build and change
| Command | What it does |
| --- | --- |
| [`/aico:lead`](lead.md) | The front door: picks the route for any request |
| [`/aico:triage`](triage.md) | Sizes and risk-rates a request, recommends the shortest route |
| [`/aico:reprompt`](reprompt.md) | Turns a rough prompt into one complete prompt |
| [`/aico:feature`](feature.md) | Builds a feature or product end to end |
| [`/aico:grill`](grill.md) | Interviews you about an idea, saves decisions |
| [`/aico:idea`](idea.md) | Guides an idea from text to a build |
| [`/aico:bug`](bug.md) | Guides a bug report to a fix |
| [`/aico:grilling`](grilling.md) | The recommended grill, with fact lookups |
| [`/aico:grill-me`](grill-me.md) | The grill with no lookups of any kind |
| [`/aico:grill-with-docs`](grill-with-docs.md) | The grill that reads your repo docs first |
| [`/aico:to-spec`](to-spec.md) | Turns an idea or grill file into a spec draft |
| [`/aico:to-tickets`](to-tickets.md) | Splits a spec into a plan of small tasks |
| [`/aico:fix`](fix.md) | Fixes a bug test-first |
| [`/aico:refactor`](refactor.md) | Restructures code with no behavior change |
| [`/aico:incident`](incident.md) | Handles a production incident |

### Assess (read-only — no code changes)
| Command | What it does |
| --- | --- |
| [`/aico:audit`](audit.md) | Prioritized report on an existing codebase |
| [`/aico:pentest`](pentest.md) | Authorized red-team test of your own build |
| [`/aico:vulnscan`](vulnscan.md) | Scans dependencies against vulnerability databases |
| [`/aico:skillspector`](skillspector.md) | Scans installed agent skills |
| [`/aico:feedback`](feedback.md) | Ranks user feedback into proposals |
| [`/aico:usability-test`](usability-test.md) | Every Persona tests a design or app |
| [`/aico:research`](research.md) | Sourced online research with a verdict |

### Upkeep and standards
| Command | What it does |
| --- | --- |
| [`/aico:maintain`](maintain.md) | Routine upkeep and chosen upgrades |
| [`/aico:standards`](standards.md) | Builds and refreshes the ruleset |
| [`/aico:brainstorm`](brainstorm.md) | Roles weigh in on an idea until you say done |
| [`/aico:cooler`](cooler.md) | Colleagues chat at the water cooler |

### Clients and launch
| Command | What it does |
| --- | --- |
| [`/aico:client`](client.md) | Client intake and handoff |
| [`/aico:launch`](launch.md) | Takes a product or release public |

### Other company types
These four commands belong to the research, marketing and design companies. In a software company they stop with "not part of your `software` company". Each one runs through the shared pipeline, so the conventions above apply. For these types the Ship Gate summary starts with a line `Ship means: …`, and the type's checks must pass before you can approve. A passed check records that Legal stated its position. It is not legal advice or a compliance certificate, so have a qualified lawyer review before you publish.

| Command | What it does |
| --- | --- |
| [`/aico:report`](report.md) | A sourced client report (research company) |
| [`/aico:campaign`](campaign.md) | A multi-channel campaign (marketing company) |
| [`/aico:content`](content.md) | One piece of content (marketing company) |
| [`/aico:design`](design.md) | A design handoff package (design company) |

### Setup and help
| Command | What it does |
| --- | --- |
| [`/aico:setup`](setup.md) | Installs skills, sets the company type |
| [`/aico:language`](language.md) | Shows or sets the language aico writes in |
| [`/aico:settings`](settings.md) | Opens the local settings page |
| [`/aico:help`](help.md) | Lists or explains commands |
| [`/aico:version`](version.md) | Shows the installed version |

You can also summon any Role directly, without a command — for example *"use the aico security agent on `src/auth`"* or *"use the aico pentester on the staging build"*. See [Roles](../roles/README.md).
