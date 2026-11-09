# From idea to shipped code

## In short

This page follows one idea, or one bug report, from a rough thought to a merged release. You are the CEO: you pick answers in forms, and the company does the rest. For every option of every command, see [Commands](../commands/README.md).

Type `/aico:idea <idea>` for an idea or `/aico:bug <bug report>` for a bug. Both walk the same route, with a form at every step. An idea is built through `/aico:feature`, a bug through `/aico:fix`. The Lead never picks the build Playbook from your text; the flow records the kind when it starts.

## How it works

### Two things to know first

- **Only the Ship Gate is left in a build.** `/aico:feature` and `/aico:fix` have no Brief Gate and no Plan Gate, also when you call them directly. You approve each ticket before the build instead, and you approve the finished work at the Ship Gate. No push, merge or release happens before the Ship Gate.
- **The flow is saved as local files.** It lives in `.company/work/<slug>/`. The Claude model you configured reads your text. See [Where your words go](../concepts/where-your-words-go.md) and the data list under Technical details below.

### The route

The route is one table. The routes are the picks you see in the forms. The allowed picks of every form come from the `idea-flow` script, so a form never offers a route that does not fit the step you are on.

| Route | What happens | Changes code? |
|---|---|---|
| Water cooler | Colleagues chat about the idea. Nothing is built. | No |
| Brainstorm | The Roles weigh in over rounds until you say done. | No |
| Research | Researchers look it up online and write one sourced report. | No |
| Spec and tickets | Write the spec, cut tickets, approve them one by one. | No |
| Park the idea | Keep a copy in `.company/ideas/<name>/` and stop. | No |
| Build | Size the approved tickets, then build them. | Yes |
| Park all tickets | Put every ticket on the roadmap and stop. | No |

In words: after the grill and the reprompt, the routes form offers Water cooler, Brainstorm, Research, Spec and tickets, and Park the idea. After Water cooler you can still pick Brainstorm, Research, Spec and tickets, or Park the idea. After Brainstorm you can pick Research, Spec and tickets, or Park the idea. After Research the prompt is rewritten once more, then you pick Spec and tickets or Park the idea. Spec and tickets ends with a tickets form that offers Build, Park all tickets or Park the idea. Spec and tickets and Build exist only in a software company. In any other company type the routes are Water cooler, Brainstorm, Research and Park the idea: after Water cooler you can still pick Brainstorm, Research or Park the idea, after Brainstorm Research or Park the idea, and after Research (and its rewritten prompt) the form is Park the idea / Stop. Stop ends the flow and parks nothing. Build builds, and Park all tickets and Park the idea end the flow.

### Step 1: Capture

1. You type the idea or the bug report.
2. The Lead saves your exact words as `.company/work/<slug>/idea.md`. Your text is data: it is quoted, never obeyed, and it never goes into a shell command.

Expected result: a work folder and the grill form.

### Step 2: Grill

You pick one of three ways to be interviewed, one question at a time, until every branch is closed:

- **Grill (recommended).** Facts the repo or the web can answer are looked up. The rest is asked. Web lookups can use short queries built from your idea.
- **Grill me.** Every question is asked. Nothing is looked up, not in the repo and not on the web.
- **Grill with docs.** The repo docs (`docs/`, `GLOSSARY.md`, `docs/adr/`) are searched first, and each answer from a doc cites it. No web search.

Expected result: a `grill.md` file with your decisions. Nothing is built, and no end form of the grill appears here, because the flow carries on by itself.

### Step 3: Reprompt

The Lead turns the idea and your grill decisions into one complete prompt: goal, context, inputs, constraints, output format and a done-check. It shows the prompt in full. The prompt is AI-written; read it before you rely on it.

Expected result: `prompt.md` in a reprompt folder, then the routes form.

### Step 4: Pick a route (Water cooler to Park the idea)

The routes form offers the first five routes from the table (outside a software company, without Spec and tickets). Each route runs in your session, up to its own end:

- **Water cooler:** you get an Overheard list. Nothing is built.
- **Brainstorm:** you get the summary and checks; you do not get its separate outcome form, because the flow's forms replace it.
- **Research:** the report ends with a verdict (go, go-with-conditions or no-go) and what to do. The research Playbook's own pick is skipped; the routes form comes next. Web search is used here, with queries built from your idea.
- **Spec and tickets** (software company only): go to step 5.
- **Park the idea:** the Lead names the idea with a short slug and copies it to `.company/ideas/<name>/`. The flow ends. The work folder stays.
- **Stop** (outside a software company, after Research, as Park the idea / Stop): the flow ends and nothing is parked.

### Step 5: Spec and tickets

The Lead writes a spec from the prompt, then cuts it into tickets automatically. A ticket is one small task of a plan: id, title, Role, files and dependencies.

Expected result: a `plan.md` with the tickets, and the first ticket form.

### Step 6: Approve tickets one by one

For each ticket you get a form with the ticket shown as plain lines: id, title, Role, files, depends-on, and `Core` or `Contract` when it touches a Core path or a Contract. You pick Approve (recommended) or Change.

- **Approve** records your approval for that exact text.
- **Change** takes your words, a fresh Architect revises only that ticket, and you see only that ticket again. There is no fixed limit: you end the loop by approving.

When every ticket is approved you get the tickets form: Build, Park all tickets, Park the idea.
### Step 7: Build or park

- **Build** (software company only). The Lead first asks again about tickets that are new or changed since your approval, with Approve (recommended), Park or Change. Parked tickets go to `.company/roadmap/`. Then it writes one build plan from the approved tickets only, sizes it (size and risk tier, no form) and starts the build Playbook: `/aico:feature` for an idea, `/aico:fix` for a bug. If every ticket was parked, nothing is built, and you pick Park all tickets or Park the idea instead.
- **Park all tickets.** Every ticket not yet parked becomes one file in `.company/roadmap/`. The flow ends with nothing built.
- **Park the idea.** As in step 4.

If you stop midway, `/aico:idea resume <slug>` or `/aico:bug resume <slug>` reopens the form you left open.

### Step 8: Build, Ship Gate and release

The build run has no Brief Gate and no Plan Gate. The ticket you approved is the brief and the plan. The steps run in this order:

1. **Build.** Builders work one task per Module, in parallel up to the parallel cap (default 4), each from its own task brief and rule slice, test-first. A bug goes through `/aico:fix`: QA writes a failing regression test, then the engineer who owns the Module fixes the root cause.
2. **Review.** The Code Reviewer, QA and the optional lanes (security, compliance, legal, and for UI the hands-on and accessibility testers) run in parallel. Blocking findings go back to the builder; the limit is 2 Fix rounds by default, then the Lead escalates to you.
3. **Full suite.** Once the last review is clean, the Lead runs the whole test suite once.
4. **Docs.** The Writer adds user docs and release notes.
5. **→ Ship Gate.** You see one summary: what changed, test results, open nits, skipped lanes and a cost line. It also holds what the two removed Gates used to show: Core and Contract changes, the parallel plan, the plan check, spike results, and the applied approve lines of your tickets from `ticket-approval read`, each shown with a `> ` prefix, with `tickets changed since approval`. You Approve, Change or Stop.
6. **PR, CI, merge.** After approval the Lead pushes the project branch `aico/<ProjectID>`, opens a pull request, waits for CI to pass and merges only when it is green. With the Ship Gate set to `auto`, the Lead opens the PR and stops; you merge it.

When something needs your decision during the build, such as a `needs-ceo` Handoff, you get one form at that moment. It is not a Gate. A refusal from a script is never bypassed.

After the merge, cut the release from the repo root:

```
npm run release <x.y.z>
```

The script updates the version and changelog and never pushes. For the release rules, see [Releases and Git](../concepts/releases-and-git.md).

### Worked example

You want users to export their data as CSV.

1. `/aico:idea users should export their data as CSV`. The Lead saves your words and shows the grill form. You pick Grill.
2. The grill looks up how exports work in the repo and asks you three questions. You pick Research on the routes form. The report says go-with-conditions and ranks "export patient list" first.
3. The Lead rewrites the prompt with the verdict. You read it, and pick Spec and tickets.
4. The spec and three tickets appear. You approve two and change one: you add that the file lists only the admin's clinic. The Architect revises that ticket and you approve it.
5. At the tickets form you pick Build. The Lead sizes the work as M with risk high, because patient data is personal data, and starts `/aico:feature`.
6. Builders run in parallel. The Code Reviewer blocks one finding. One Fix round later the review is clean.
7. The full suite passes. At the Ship Gate you read the summary, approve, and the Lead opens the PR, waits for CI and merges.
8. You run `npm run release 1.4.0`.

For a bug, type `/aico:bug <report>` instead. Every step is the same until Build, which starts `/aico:fix`.

## Technical details

### Commands and scripts

All calls go through `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs"`. The route is shared by both commands in `skills/idea/references/routes.md`. Contract `idea-flow` v1.1, ADR 0048.

The script gives every pick in a form a letter, and the forms show the route names: Water cooler, Brainstorm, Research, Spec and tickets, Park the idea, Build, Park all tickets. It reads the company type with `company-type resolve` and never lists Spec and tickets or Build outside a software company; picking either there is refused.

- `idea-flow start <slug> --kind idea|bug`: creates the record and the work folder. Prints `started`. A record that exists exits 1 with `exists`; the Lead then appends `-2` to `-9` to the slug and retries.
- `idea-flow options <slug>`: one `option <letter> <route>` line per allowed pick. `pending <step>` or `ended` means no form.
- `idea-flow pick <slug> <letter>`: the letter must be one of the open form's options, else `refused: not an allowed pick`, exit 3, nothing written. Prints `picked <letter> <route>`.
- `idea-flow state <slug>`: its `build:` line decides the build Playbook. Only `aico:feature` or `aico:fix` is ever started; the idea, grill and ticket text never choose it.
- `idea-flow park-idea <slug> <name>`: prints `parked <final-name>`. `name refused` or `name taken` exits 1.
- `ticket-approval tickets`, `ticket` and `build-plan`: ticket approval, one hash per ticket (the first 12 hex of SHA-256 over its task block) plus one hash for the plan sections before `## Tasks`, approved as item `S0`. `build-plan` refuses until S0 is approved. The record is `.company/work/<slug>/tickets.jsonl`; no Gate reads it. Contract `ticket-approval` v1.4.
- Refusals print `refused: <reason>` and exit 3. Fail-loud errors (`unknown slug`, `exists`, `step out of order`, `broken record` and others) exit 1. A broken record makes the Lead show it and stop.
- Every argument is at most 4096 characters, else `refused: argument is not accepted`, exit 3, before any command runs.

### Files

- `.company/work/<slug>/idea.md`: your exact words.
- `.company/work/<slug>/` grill folder: `grill.md`; reprompt folder: `prompt.md`.
- `.company/work/<slug>-build/plan.md`: the build tickets, written before the build pick is recorded.
- `.company/ideas/<name>/`: a parked idea.
- `.company/roadmap/`: parked tickets, one file each.

### Where your text goes

- The Claude model you configured reads your idea, bug, grill, ticket and Lead Handoff text.
- The web search tools (WebSearch, WebFetch) run in grill lookups and in research, and in the Water cooler and Brainstorm routes when a Role that holds them (market-researcher, tech-researcher, design-researcher, skill-researcher, senior-engineer or vuln-scanner) joins; those two routes do not forbid it, and a request can carry words from the idea. No other recipient. `/aico:grill-me` never searches the web. `/aico:grill-with-docs` does not either.
- Everything else is local files: the folders above and `.company/draft-input-arg-*.txt`. aico writes no ignore rule; they are git-ignored only where your product ignores `.company/`.
- The Lead hand-over hooks read token counts from the local Claude Code transcript and store none of its text.
- Nothing in the idea flow is pushed or published.

### Contexts and hand-overs

Every Role works under one cap: 95000 tokens, with a hand-over at 85500. The Lead hands over through hooks and points you to a new session; it needs [no setup](setup.md). You never need to clear a session or type "resume" for it.

### Coming in the next release

> **Not shipped yet.** These items are in development on the Elephant-Goldfish branch. They are not in `main`, and the steps above do not use them.
>
> - **Fresh plan reviewer.** A protected Role reviews the plan with no memory of how it was made.
> - **Comprehension paraphrase.** The reviewer restates the plan in its own words.
> - **Review-loop stop rules.** A record of each review loop, with rules that stop it when it stops making progress.
> - **Contest evidence.** A contest must carry checkable evidence, and CEO rulings and dated exceptions are recorded in files.
> - **Drift report.** `/aico:maintain drift` compares picked Contracts with the code and reports differences. It is informational and never blocks.
> - **Per-task worktrees.** Parallel builder tasks run in separate git worktrees beside the repo and are merged in plan order.
> - **Durable spec.** Each shipped feature leaves a destination spec in your repo, with no file paths and no code.
> - **Prototype step.** A throwaway prototype step for design questions.
