# Concepts

The ideas the whole company runs on. Short definitions of every term are in [`../GLOSSARY.md`](../GLOSSARY.md).

## Roles, the Lead and the CEO
You are the **CEO** — the human. You're not a Role; you have the final say and approve work at Gates. The **Lead** (Project Manager) takes your request, picks the Roles, sequences them and runs the Gates. A **Role** is a specialist agent that starts with a fresh context, does one job, and hands off. See [Roles](roles.md).

## Handoffs
A Role never keeps work in its head for the next Role. Each one writes a **Handoff** file — frontmatter plus `## Did`, `## Next`, `## Blocking` sections — that the following Role reads. Handoffs live under `.company/work/<task>/` as `NN-<role>.md`. This is why a run survives a Role failing or restarting: the files are the memory, not the conversation.

## The Handoff Contract
Handoffs aren't just prose — each carries machine-readable frontmatter the Lead and later Roles read as fields: `status`, `round`, `base-commit` (what reviewers diff against), `risk-tier`, `acceptance-ids` (which of the brief's criteria this Step delivers) and `files-touched`. Blockers are tagged `contract`, `spec`, `security` or `test` so the Lead routes a Fix round precisely. Because the fields are structured, independent Steps run **in parallel by default**, reviewers scope to `base-commit` instead of re-reading history, and a run can resume from any Step after a restart.

**v1.1 (pilot, off by default).** With the setting `pipeline.review_format: pilot` (default `plain`, see [Settings](#settings)), the code-reviewer and the compliance Step of the senior-engineer also write a short `aico-top` block right under the By line, with `status`, `files`, `ac_ids`, `rule_ids`, `risks`, `read_next` and `tokens_used`. Their findings are rows: `ID | file:line | problem | why | fix`. The IDs are stable, so a Fix round cites `R-3` instead of retyping the finding, and "why" is never empty. A malformed block blocks that Step. With `plain`, they write ordinary findings and no block. Other Roles write Handoffs as before; the body stays plain English for Gate summaries, exceptions, Debt and security risks. The block is widened to more Roles only after the token numbers support it.

## Context budget
No agent works with more than **150k tokens** of context by default, the Lead included. Long contexts get sloppy and compaction drops detail, so a Role that gets close stops at a clean point (tests green, nothing half-edited) and writes its Handoff with `status: handover`, listing exactly what's left under `## Next`. The Lead then dispatches a fresh Step of the same Role to carry on from there. A handover isn't a failure and doesn't use up a Fix round. If the Lead itself gets close, it saves the run state to `00-lead-state.md` and asks you to continue in a fresh session with "resume <slug>".

You can change the limit for Roles in [settings](#settings) as **max context** (`context_cap`): one global value, with an override per Role. The default is 150000 and the floor is 60000; lower values are refused. A Role hands over at 80% of its cap. High-risk work never gets less than the default, whatever you set. The cap is a soft limit that the Lead passes in each dispatch; it is not enforced by the model.

## Token cost
aico records how many tokens each Step used in a ledger at `.company/ledger/<run>.jsonl`. The ledger stores **counts only**: no prompts, no replies. At the Ship Gate the Lead shows one cost line, with spend (input, cache write and output) and cache read kept apart. `/aico:feedback` compares the last three runs.

### Run scorecard
Once you approve the Ship Gate, the Lead prints one scorecard line for the run. Each figure sits beside the median of the last 5 shipped runs:

- **time**: from the start of the run to the Ship Gate answer, including your waits.
- **CEO wait**: how much of that time was spent waiting for your answer at the Brief, Plan and Ship Gates.
- **spend/AC**: spend tokens (input, cache write, output; cache read is left out) per shipped acceptance criterion. It reads `not reconciled` when the run has no reconciled counts.
- **fix rounds** and **high blockers**: the totals for the run.
- **gate rejects**: the number of "no" answers at the three Gates.

Reading the line:
- `n=<k>` means the median uses only k earlier runs (1 to 4). `no baseline` means there are none yet.
- `excluded: <n>` counts runs left out of the median: brainstorm, replay and baseline runs, and runs without times.
- With a token baseline, a `30% target` segment compares spend per AC with that baseline and reads `met`, `missed` or `not reconciled`. `met` also needs fix rounds and high blockers no higher than the baseline's.
- Older ledger files still work. They count as untimed and appear under `excluded`.

The scorecard only reports. It never blocks a Step or a Gate. It stores times, counts and tier, never prompts, replies or names, and the ledger stays in the repository. It is committed with the run only when the product tracks `.company/`, otherwise it stays local, and aico sends it nowhere. The numbers are a baseline to measure changes against; aico makes no speed or cost claim from them yet.

The savings come from reading less: shorter prompts, fewer file reads, fewer dispatches, a digest in place of a full transcript. Brainstorm Roles also keep one constant prompt for the whole run, with changing content in a per-round input file. aico claims no saving percentage for this yet. Prompts keep one fixed order so they stay readable and testable.

## Tool checks, slices and review depth
- **Tool checks.** A rule can carry `check: <tool>` or `check: judgment`. Checks bind to a rule by its ID in `.company/checks.json` and run before review. A failure becomes a finding that the reviewer must confirm before it blocks. Compliance stays a separate lane.
- **Rule slices.** These stay on whatever the review format is. Each task gets only its mapped rules, and always every security Must. The Senior Engineer renders them into one small file per task, `.company/work/<slug>/rules/<task>.md`, with the rule text included. Builders get that file instead of the full ruleset map. `rule-check slices` verifies the files and flags missing, stale or extra ones.
- **Findings ledger** (only with `pipeline.review_format: pilot`). A reviewer writes its findings and checked files to `<NN>-code-reviewer.findings.md` only when a handover is near (at 75% of the max context, or once it decides to hand over). A handover without a ledger fails the lint, so nothing is lost; a review that finishes normally needs none.
- **Review depth** follows the paths touched (`scripts/review-depth.mjs`), not the builder's own label. Contract, Core and security paths always get a full review.
- **Golden Handoffs and the regression set.** Reference Handoffs and past high-tier defects run under `npm test`, so a change that loosens a Gate or the Handoff shape fails a test.

## Risk tier
Every piece of work gets a tier — `low`, `medium` or `high` — set in the brief and confirmed by you at the Brief Gate, then carried in every dispatch. It's forced **high** for anything touching auth, payments, personal data, migrations or a Contract. The tier drives how deep QA tests, how much of the ruleset applies, and how short a route triage may recommend. A Role can raise a tier but never lower it, and no tier ever removes a criterion's single test or skips the Ship Gate's full suite.

## The reviewer pre-filter
Before the Code Reviewer runs, a cheap deterministic check (the same `aico-check` the CI uses) scans the diff and hands its findings to the reviewer. It is **additive only**: it can append tagged findings but never remove, downgrade or close one, never marks a review done, and a pre-filter block never counts against the Fix-round limit. Only the Opus reviewer closes a review. This spends human-grade attention on logic and Contracts, not mechanics — without softening any Gate.

## Gates
A **Gate** is a point where the Lead stops and waits for your approval. There are three: **Brief** (scope agreed), **Plan** (plan/design agreed) and **Ship** (before anything is released or made public). At each you can Approve, Change or Stop. Every question the company puts to you — Gates, picks from a report, decisions a Role can't make — comes as a form you click through, never as a question buried in the chat output. See [Getting started](getting-started.md#the-three-gates).

In [settings](#settings) you can set a Gate to **auto**: the Lead writes the Gate summary to the run folder and carries on, then tells you it did. The Ship Gate and installs start **locked** (see [Locks](#locks)). An auto Ship Gate commits the run's wrap-up, pushes the branch and opens a PR, then stops. It never merges. Some asks always stay a form whatever the settings say: Must exceptions, Blocking security findings, picks from a report, escalations, design-skill approval, and anything sent outside your machine other than that PR (client messages, publishing, authority reports, production deploys, and every Ship Gate in `/aico:incident`).

## Core + Modules + Contracts
Every product is built the same way:

- **Core** — the small, stable center. Only CEO-approved items go in Core.
- **Modules** — self-contained feature units built against Contracts, in parallel when their Contracts are settled.
- **Contracts** — the versioned interfaces and schemas Modules talk through. The Architect owns them; builders code against them.

This keeps Modules independent and swappable, and keeps the risky surface (Core) small and approved by you.

## The Ruleset
A product's binding engineering rules, kept by the **Senior Engineer** and signed off by the Architect. Built and maintained with [`/aico:standards`](commands.md#aicostandards).

- **Rule packs** hold the rules for one tool and major version (`<tool>@<major>.md`), each rule with its source URL. They live in a shared library on your machine (`~/.mcsparrow/standards/`) and are copied into each product under `.company/standards/`; the product's own rules and the pack list live in `.company/standards.md`.
- **Freshness.** `node scripts/check.mjs --packs <dir>` fails a library pack that is older than 90 days or has a new advisory in its `advisories.json` since its date. CI checks the committed copies and fails only after 180 days, so CI doesn't go red just because a copy aged. The checker never goes online.
- **Tiers:** **Must** (always followed; a break blocks a run — all security rules are Must), **Should** (followed, or a written reason) and **May** (advice).
- **Sources:** Must rules come only from primary sources — official docs, style guides, linter defaults, and security bodies (OWASP, CWE, CISA KEV, vendor advisories). Should/May may also cite well-known community guides. Blogs, forums and AI-generated content are never a source.
- **Exception:** only you (the CEO) can approve not following a Must, in a stated scope. It's recorded with its date.
- **Security is law:** builders follow the rules *before* review, so a Fix round caused by a rule break is treated as a process failure, not normal flow.

## Debt
Existing violations of a rule that arrived *after* the code was written. Debt is listed in the Ruleset and **never blocks** a run — you decide when to pay it down with a fix or refactor run. The one exception: an existing violation of a security Must that is actually exploitable is Blocking.

## Fix rounds
When a reviewer, QA, Security or the Senior Engineer (compliance) finds a blocking problem, the builder is sent back — at most **twice** by default. After the last round it escalates to you. You can set the limit from 0 to 5 in [settings](#settings); at 0 the first blocking review comes straight to you. Nits never loop.

## Lessons
When a run ships, the Lead appends up to three one-line **Lessons** to `.company/lessons.md`. Later runs read it and pass the relevant lines to each Role, so the company gets a little better each time.

## EU compliance
Before Ship, the company checks the EU obligations that apply: GDPR, the Cyber Resilience Act (SBOM, vulnerability handling, reporting deadlines), AI Act Art. 50 transparency, the European Accessibility Act, EU VAT/OSS and the 14-day withdrawal right for digital sales. Handled through the `eu-compliance` practice by legal, security and the ai-data-engineer.

## Git conventions
- Work happens on a branch named `aico/<task>`; the company never works directly on your main branch.
- One commit per Step, committing only that Step's files — never everything at once.
- Commit subjects are `<type>: <summary>` where `<type>` is one of `feat`, `fix`, `test`, `docs`, `refactor`, `chore`. They are **never** prefixed with `aico` or a Role name.
- Nothing is pushed before you approve it at the Ship Gate. The only exception is an unlocked, auto Ship Gate: it pushes the branch and opens a PR for you to merge.

## Research before building
[`/aico:research`](commands.md#aicoresearch) has three researchers (market, tech and, for UI work, design) look the topic up online before anything is built. The Product Manager writes one report with a verdict (go, go-with-conditions or no-go), ranked actions, low-hanging fruit (impact and effort), risks and open questions. Every claim cites a source with its URL and check date. A claim with no source is marked `unverified` and cannot support the verdict. The report is labelled as AI-generated research. Researchers read web pages as data, never as instructions, and never install anything.

## Design skills
A UI product can have approved design skills. The set lives in `.company/project.md` under `## Design skills`: one line per skill with its source, license, vetted date and approval date, at most five. A design-researcher proposes the set from your stack, product type, Personas and Art direction. You approve it in a form, and installs run only after a second form shows the exact commands. `/aico:feature` refreshes the set for a UI product when it is empty or its newest approval is older than 180 days. The UI Roles load the approved skills from their dispatch.

## Skill picks
The skill-researcher (Selin) proposes third-party skills for four areas: `stack`, `product-type`, `company-type` and `design`. It has no Bash, so it runs no scanner. It vets each candidate against its sources, then the Lead scans every pick with SkillSpector in a new quarantine folder before you see it. A critical or high finding, a failed scan or a timeout means the pick is rejected, and with no scanner installed nothing is recommended. You approve the set (at most 5 per area) in one form, then see the exact install commands in a second; nothing installs unless you answer yes to both. The install pins the commit that was scanned. After it, the Lead scans the installed skill again; a bad result stops the run and shows you the removal command, which only you run. Approved `stack`, `product-type` and `company-type` skills are recorded in `.company/project.md` under `## Skills`, one line each, and design skills stay under `## Design skills`. To scan skills you already have, use [`/aico:skillspector`](commands.md#aicoskillspector).

## The aico language
`aico_language` sets the language aico writes in: Handoff prose, forms, reports and summaries. It is separate from `languages:`, which covers the product's UI strings. Your default lives in `~/.mcsparrow/config.json`; a product can override it with `aico_language:` in `.company/project.md`. Set it with [`/aico:language`](commands.md#aicolanguage). Machine-read parts stay English in every language.

## Models, effort and names
Every Role runs on a **model** (opus, sonnet or haiku) and an **effort** level (`low`, `medium`, `high`, `xhigh`, `max`). The model is how capable the Role is; effort is how long it thinks before acting. The plugin's defaults put the deepest thinking where a miss is expensive (architect, code-reviewer, security, pentester on high) and keep writing, art, lookup and support work on low. Every Role also has a person name for display, such as Ava the architect or Quinn the QA tester. Names show in cooler chats, brainstorms, Gate summaries and Handoff bylines (`By: Ava (architect)`). You can ask for a Role by name ("ask Ava to check the Contracts"). Internal IDs like `aico:architect` never change. The full list is in [Roles](roles.md).

## Company types
A project has one company type. It decides which Roles and Playbooks the company has and what "ship" means. Set it with [`/aico:setup`](commands.md#aicosetup); it is saved as `company_type:` in `.company/project.md`. With no `company_type:` line a project is a `software` company, exactly as before. Switching a type later is not supported, and the settings page neither shows nor changes it.

| Type | Roles | Playbooks | What "ship" means |
|---|---|---|---|
| `software` (Software company) | 34 Roles, every Role except the editor | audit, brainstorm, client, cooler, feature, feedback, fix, incident, launch, maintain, pentest, refactor, research, standards, usability-test, vulnscan | Push, merge, release or deploy. Unchanged. |
| `research` (Research consultancy) | 11 | research, client, report, feedback, brainstorm, cooler | The final report goes to the client or is published, with every claim cited `[S#]` or marked `(unverified)`. |
| `marketing` (Marketing and content agency) | 15 | campaign, content, research, client, feedback, brainstorm, cooler | The work is published or handed to the client after the legal and accessibility lanes, with every claim cited or marked unverified. |
| `design` (Design studio) | 19 | design, research, client, feedback, brainstorm, cooler | The design handoff package (files, specs, tokens and the asset licence record) goes to the client or the build team. |

Every type also has `help`, `version`, `language`, `settings`, `setup`, `lead`, `triage`, `skillspector` and `reprompt`, and every type has the reprompter Role. The Lead and `/aico:triage` route only to the type's own Playbooks and Roles, and `/aico:cooler` and `/aico:brainstorm` pick Roles only from it. A Role or command outside the type is refused with the list of allowed ones, and nothing is dispatched.

For types other than `software`, the Ship Gate summary starts with `Ship means: …`. The type also switches on review lanes and checks that settings cannot turn off:

| Type | Lanes forced on at Ship | Checks that must pass |
|---|---|---|
| `research` | legal | `claims-cited` |
| `marketing` | legal, accessibility | `claims-cited`, `ai-disclosure`, `asset-licences` |
| `design` | legal, accessibility, security | `ai-disclosure`, `asset-licences`, `handoff-package` |

A check with no matching Handoff is an open blocker:
- **`claims-cited`**: an editor Handoff in the run with `status: done` and no blocking finding. Every claim is cited `[S#]` or marked `(unverified)`.
- **`ai-disclosure`**: a legal Handoff that states, for each AI-generated public image, video or text, which AI Act art. 50 duty applies and how it is met, or the reason none applies (for example: not a deepfake; a human reviewed it and holds editorial responsibility; not text published to inform the public on matters of public interest). It also says `deepfake: yes` or `deepfake: no`, where a deepfake is a realistic person, place or event. A run with no AI-generated assets states `ai-disclosure: none (no AI-generated assets)`.
- **`asset-licences`**: the same legal Handoff, stating the licence of every asset.
- **`handoff-package`**: a UI/UX designer Handoff that lists the files, specs, tokens and the asset licence record.

A passed check records that Legal stated its position. These checks are a process check, not legal advice or a compliance certificate. Have a qualified lawyer review before you publish. In particular, the timing of the AI Act art. 50 duties may still change, so confirm the dates with a lawyer. Personas used in testing are fictional, and copy must never present one as a real customer.

To see which type a project has, and what it allows, the plugin script `company-type.mjs` prints plain lines by default:

```
company type: research (Research consultancy), from .company/project.md
roles: product-manager, account-manager, …
playbooks: research, client, report, …
work: report
ship: deliver-report. The final report goes to the client or is published, …
ship lanes: legal
ship checks: claims-cited
skill search hints: …
```

A project with no `company_type:` line shows `company type: software (Software company), default: no company_type line`. `work` lists the Playbooks that do the type's main work. When a brainstorm, a research run or a feedback run hands an idea over, it goes to the first of them. Tools that parse the output pass `--json` to get JSON instead. A refusal is one line starting with `refused:` that names the bad input, never a value from your project file.

The `design` company has two Roles that the brief did not list, `code-reviewer` and `security`, because a clickable prototype is code and the security lane is always on. The software Ship Gate is unchanged. If the type setting is broken, for example an unknown value or two `company_type:` lines, a Playbook stops with a refusal and changes nothing.

## Personalities
Every Role has a personality that colours how it comes across in [`/aico:cooler`](commands.md#aicocooler) chats and [`/aico:brainstorm`](commands.md#aicobrainstorm) rounds. It is social-only style data, used there and nowhere else. It never changes a model, an effort, a verdict, a review, a Gate, a Handoff or any other dispatch.

A personality has five fields:
- **Temperament**, **Way of talking** and **Pet topic**: short text, 1 to 80 characters. Letters of any language, digits, single spaces and the marks `, . ' - ! ?` are allowed. Quotes, colons, brackets, line breaks and other symbols are refused.
- **Intelligence** and **Creativity**: `low`, `medium` or `high`. The Role is told a fixed sentence for the level you pick, not the word itself. Creativity shows in how far the ideas reach. Intelligence shapes how the Role reasons, but brainstorm replies are capped at 80 words, so you will see little of it there.

Every Role ships with a default. You can change each field at user level (all projects) or project level. Per field, the project value wins over the user value, which wins over the default. A project value counts without an unlock, so a cloned repo can set a personality. It is passed to the Role only as quoted style data, never as an instruction, and it can only reach cooler chats and brainstorms. A value that breaks the rules is ignored, the level below is used, and the settings page and `settings.mjs get` warnings say which field. The warning does not repeat the value.

Personalities are not part of `settings.mjs get` and are never printed by a command. Personality is about Roles, not real people, so keep real names out of it. Each word of a text field starts with a letter or a digit, and invisible characters are refused. In a first test, a personality changed the tone of brainstorm replies and did not lower the share of replies that pass the parser. A pet topic colours a reply only now and then.

## Settings
[`/aico:settings`](commands.md#aicosettings) opens a page in your browser where you change how the company works. It has seven tabs, in this order. Messages ("Saved.", or a refused Save) show at the top, under the page header, so you see them on every tab.

- **Roles** — name, model and effort for each Role, with a bulk change per department. Every field has a visible label.
- **Personality** — one collapsible card per Role, grouped by department, with a User and a Project group of fields. Each group names its Role and level, for example "Ava (architect), User level". The fields are three text boxes with an "n of 80 characters" counter, and two lists for Intelligence and Creativity. Under each list you see what the Role is told for the level you pick. A blank box means "not set at this level". Above the cards, **Filter Roles** narrows them by name, Role or department, and a line says "Showing n of N Roles". The filter only hides cards: hidden cards are still saved, and the filter text is never saved. A refused Save puts "Nothing was saved. Fix n field(s):" at the top, with one link per problem. A link opens the right tab and card and puts focus on the field. Nothing is saved from a refused Save.
- **Language & profile** — the aico language and the `.company/project.md` profile fields.
- **Pipeline** — the Fix-round limit, the reprompt Question rounds (`reprompt.question_rounds`, 0 to 3, default 1), parallel or one-at-a-time dispatch, the max context (`context_cap`, global and per Role), the review format (`pipeline.review_format`, below), which optional review lanes run (security, compliance, legal, persona, hands-on and accessibility testing), and the brainstorm options: debate style (`brainstorm.debate`) and the film script (`brainstorm.film_script`).
- **Gates** — ask or auto for the Brief, Plan and Ship Gates and for installs.
- **Mods** — on or off and the options for the four [mods](mods.md), including the Blast Radius commit gate.
- **Skill scan** — the SkillSpector scan mode (`skillspector.mode`: `no-llm` or `claude_cli`, default `no-llm`). `no-llm` sends no skill text anywhere, but package names, versions and ecosystems from a skill's dependency files go to OSV.dev for a vulnerability lookup, plus the ids of any vulnerabilities found. `claude_cli` also sends skill text to Anthropic and counts only from your user settings.

Each setting has three levels, shown side by side: the **plugin** default, your **user** default (`~/.mcsparrow/config.json`) and a **project** override (`.company/settings.json`; profile fields stay in `.company/project.md`). The project wins over the user, and the user wins over the plugin. Changes apply from the next aico run. With nothing set, aico behaves exactly as before.

`inherit` as a model means "use the model of the session you run aico in".

**Review format** (`pipeline.review_format`: `plain` or `pilot`, default `plain`). With `plain`, the Code Reviewer and the compliance pass write ordinary findings. With `pilot`, they also write the `aico-top` block, findings as `ID | file:line | problem | why | fix` rows, and a findings ledger when a review hands over; the Lead then checks those Handoffs with `--require-top`. It is not a lock. What we measured, counts only: in a first test (6 re-reviews each way), 4 of 6 pilot Handoffs failed the lint and 2 of 6 wrote a ledger on a finished review. Those were fixed and tested again (3 re-reviews each way, plus 3 forced handovers and a continuation). Both modes pass: with `pilot`, every Handoff passed the lint on the first try, and with `plain` there is no `aico-top` block and no findings ledger. The one part not exercised is appending to a findings ledger, because no new finding came up. `pilot` cost about 5.7k more tokens per re-review than `plain` (about 27.2k against 21.5k). So `pilot` is an opt-in that costs more and is not shown to save anything. Rule slices for builders and search-then-read stay on with either value.

The page runs only on your own machine (127.0.0.1) behind a one-time link, and closes when you press Done or after 30 minutes idle. At the start of every run the Lead tells you which project-level overrides are active, so a cloned or client repo can't quietly change how its Roles work.

## Locks
Some settings could skip a safety check, so they start **locked**: auto for the Ship Gate, auto for installs, and switching off the security or compliance review lanes. Two mod settings are locked the same way: Blast Radius `security: warn` and switching Blast Radius off (see [Mods](mods.md#locks)). You unlock each one on the settings page behind a warning that says what will no longer ask you. Unlocks count **only from your user settings**: a project file can lock things again but never unlock them, so a repo you clone can't turn on auto-push or skip security review on your machine. If a project's settings file is broken, its locks hold anyway.

## The `.company/` folder
Everything a job produces lands here, in your product's repo, in plain files you can read:

- `.company/project.md` — the product profile (type, stack, voice, license, approved Core)
- `.company/settings.json` — this project's [settings](#settings) overrides, if any
- `.company/work/<task>/` — the Handoffs and reports for each job
- `.company/standards.md` and `.company/standards/` — the Ruleset and its rule-pack copies
- `.company/lessons.md` — the running list of Lessons
- `.company/ledger/` — the token ledger, counts only
- `.company/brainstorms/`, `.company/roadmap/`, `.company/nice-to-have/`, `.company/parked/` — ideas from [`/aico:brainstorm`](commands.md#aicobrainstorm) at each stage
- `.company/cooler/` — recorded chats from [`/aico:cooler`](commands.md#aicocooler)
- `.company/research/` — reports from [`/aico:research`](commands.md#aicoresearch); `outcome:` records your pick
