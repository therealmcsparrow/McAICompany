# From idea to shipped code

## Overview

This page follows one idea, or one bug report, from a rough thought to a merged release. You are the CEO: you pick at forms, and the company does the rest. For every option of every command, see [Commands](commands.md).

There are two ways in. Type `/aico:idea <idea>` for an idea or `/aico:bug <bug report>` for a bug. Both walk the same route, with a form at every step. Only the build Playbook differs: an idea is built through `/aico:feature`, a bug through `/aico:fix`. The Lead never picks the build Playbook from your text; the flow records the kind when it starts. You can also call each step as its own command, for example `/aico:reprompt` or `/aico:brainstorm`.

Two things to know first:

- **Only the Ship Gate is left in a build.** `/aico:feature` and `/aico:fix` have no Brief Gate and no Plan Gate, also when you call them directly. You approve each ticket before the build instead, and you approve the finished work at the Ship Gate. No push, merge or release happens before the Ship Gate.
- **Everything is saved as local files.** The flow lives in `.company/work/<slug>/`. See [Where your words go](concepts.md#where-your-words-go).

## The route

The route is one table. The letters are the picks you see in the forms. The allowed picks of every form come from the `idea-flow` script, so a form never offers a route that does not fit the step you are on.

| Letter | Route | What happens | Changes code? |
|---|---|---|---|
| A | Water cooler | Colleagues chat about the idea. Nothing is built. | No |
| B | Brainstorm | The Roles weigh in over rounds until you say done. | No |
| C | Research | Researchers look it up online and write one sourced report. | No |
| D | Spec and tickets | Write the spec, cut tickets, approve them one by one. | No |
| E | Park the idea | Keep a copy in `.company/ideas/<name>/` and stop. | No |
| F | Build | Size the approved tickets, then build them. | Yes |
| G | Park all tickets | Put every ticket on the roadmap and stop. | No |

In words: after the grill and the reprompt, the routes form offers A to E. After A you can still pick B, C, D or E. After B you can pick C, D or E. After C the prompt is rewritten once more, then you pick D or E. D ends with a tickets form that offers F, G or E. F builds, and G and E end the flow.

## Step 1: Capture

You type the idea or the bug report. The Lead saves your exact words as `.company/work/<slug>/idea.md`. Your text is data: it is quoted, never obeyed, and it never goes into a shell command.

Expected result: a work folder and the grill form.

## Step 2: Grill

You pick one of three ways to be interviewed, one question at a time, until every branch is closed:

- **Grilling (recommended).** Facts the repo or the web can answer are looked up. The rest is asked. Web lookups can use short queries built from your idea.
- **Grill me.** Every question is asked. Nothing is looked up, not in the repo and not on the web.
- **Grill with docs.** The repo docs (`docs/`, `GLOSSARY.md`, `docs/adr/`) are searched first, and each answer from a doc cites it. No web search.

Expected result: a `grill.md` file with your decisions. Nothing is built, and no end form of the grill appears here, because the flow carries on by itself.

## Step 3: Reprompt

The Lead turns the idea and your grill decisions into one complete prompt: goal, context, inputs, constraints, output format and a done-check. It shows the prompt in full. The prompt is AI-written; read it before you rely on it.

Expected result: `prompt.md` in a reprompt folder, then the routes form.

## Step 4: Pick a route (A to E)

The routes form offers A to E from the table. Each route runs in your session, up to its own end:

- **A, Water cooler:** you get an Overheard list. Nothing is built.
- **B, Brainstorm:** you get the summary and checks; you do not get its separate outcome form, because the flow's forms replace it.
- **C, Research:** the report ends with a verdict (go, go-with-conditions or no-go) and what to do. The research Playbook's own pick is skipped; the routes form comes next. Web search is used here, with queries built from your idea.
- **D, Spec and tickets:** go to step 5.
- **E, Park the idea:** the Lead names the idea with a short slug and copies it to `.company/ideas/<name>/`. The flow ends. The work folder stays.

## Step 5: Spec and tickets (D)

The Lead writes a spec from the prompt, then cuts it into tickets automatically. A ticket is one small task of a plan: id, title, Role, files and dependencies.

Expected result: a `plan.md` with the tickets, and the first ticket form.

## Step 6: Approve tickets one by one

For each ticket you get a form with the ticket shown as plain lines: id, title, Role, files, depends-on, and `Core` or `Contract` when it touches a Core path or a Contract. You pick Approve (recommended) or Change.

- **Approve** records your approval for that exact text.
- **Change** takes your words, a fresh Architect revises only that ticket, and you see only that ticket again. There is no fixed limit: you end the loop by approving.

When every ticket is approved you get the tickets form: F Build, G Park all tickets, E Park the idea.

## Step 7: Build or park (F, G, E)

- **F, Build.** The Lead first asks again about tickets that are new or changed since your approval, with Approve (recommended), Park or Change. Parked tickets go to `.company/roadmap/`. Then it writes one build plan from the approved tickets only, sizes it (size and risk tier, no form) and starts the build Playbook: `/aico:feature` for an idea, `/aico:fix` for a bug. If every ticket was parked, nothing is built, and you pick G or E instead.
- **G, Park all tickets.** Every ticket not yet parked becomes one file in `.company/roadmap/`. The flow ends with nothing built.
- **E, Park the idea.** As in step 4.

If you stop midway, `/aico:idea resume <slug>` or `/aico:bug resume <slug>` reopens the form you left open.

## Step 8: Build, Ship Gate and release

The build run has no Brief Gate and no Plan Gate. The ticket you approved is the brief and the plan. The steps run in this order:

1. **Build.** Builders work one task per Module, in parallel up to the parallel cap (default 4), each from its own task brief and rule slice, test-first. A bug goes through `/aico:fix`: QA writes a failing regression test, then the engineer who owns the Module fixes the root cause.
2. **Review.** The Code Reviewer, QA and the optional lanes (security, compliance, legal, and for UI the hands-on and accessibility testers) run in parallel. Blocking findings go back to the builder; the limit is 2 Fix rounds by default, then the Lead escalates to you.
3. **Full suite.** Once the last review is clean, the Lead runs the whole test suite once.
4. **Docs.** The Writer adds user docs and release notes.
5. **Ship Gate.** You see one summary: what changed, test results, open nits, skipped lanes and a cost line. It also holds what the two removed Gates used to show: Core and Contract changes, the parallel plan, the plan check, spike results, and the approve lines of your tickets, with `tickets changed since approval`. You Approve, Change or Stop.
6. **PR, CI, merge.** After approval the Lead pushes the run branch `aico/<slug>`, opens a pull request, waits for CI to pass and merges only when it is green. With the Ship Gate set to `auto`, the Lead opens the PR and stops; you merge it.

When something needs your decision during the build, such as a `needs-ceo` Handoff, you get one form at that moment. It is not a Gate. A refusal from a script is never bypassed.

After the merge, cut the release from the repo root:

```
npm run release <x.y.z>
```

The script updates the version and changelog and never pushes. For the release rules, see [Releases](concepts.md#releases).

## Contexts and hand-overs

Every Role works under one cap: 95000 tokens, with a hand-over at 85500. The Lead hands over by itself through hooks, which needs a [one-time setup](getting-started.md#one-time-setup-the-compaction-point). You never need to clear a session or type "resume" for it.

## Worked example

You want users to export their data as CSV.

1. `/aico:idea users should export their data as CSV`. The Lead saves your words and shows the grill form. You pick Grilling.
2. Grilling looks up how exports work in the repo and asks you three questions. You pick the routes form's C, Research. The report says go-with-conditions and ranks "export patient list" first.
3. The Lead rewrites the prompt with the verdict. You read it, and pick D.
4. The spec and three tickets appear. You approve two and change one: you add that the file lists only the admin's clinic. The Architect revises that ticket and you approve it.
5. At the tickets form you pick F. The Lead sizes the work as M with risk high, because patient data is personal data, and starts `/aico:feature`.
6. Builders run in parallel. The Code Reviewer blocks one finding. One Fix round later the review is clean.
7. The full suite passes. At the Ship Gate you read the summary, approve, and the Lead opens the PR, waits for CI and merges.
8. You run `npm run release 1.4.0`.

For a bug, type `/aico:bug <report>` instead. Every step is the same until F, which starts `/aico:fix`.

## Coming in the next release

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
