# From idea to shipped code

This page follows one idea from a rough thought to a merged release, using the commands in v0.20 on `main`. You approve at the Gates; the company does the rest. For every option of every command, see [Commands](commands.md).

The path has five stages. You can enter at any stage and stop after any of them.

| Stage | Command | Changes code? |
|---|---|---|
| 1. Capture | `/aico:reprompt`, `/aico:cooler`, `/aico:brainstorm` | No |
| 2. Check | `/aico:research` | No |
| 3. Size it | `/aico:triage` | No |
| 4. Build | `/aico:feature` (or `/aico:fix` for a bug) | Yes |
| 5. Release | `npm run release <x.y.z>` | Version and changelog only |

## 1. Capture the idea

Pick the command that matches how formed the idea is.

- **A rough prompt.** `/aico:reprompt <prompt>` turns it into one complete prompt: goal, context, inputs, constraints, output format and a done-check. It asks up to 3 questions if a gap would change the result, shows the prompt in a frame, and you choose Use it, Edit, Keep only or Stop. Nothing runs until you choose Use it. The prompt is AI-written; read it first.
- **A vague worry or itch.** `/aico:cooler [topic]` lets 2 to 5 random colleagues talk it over unmoderated. You get a file in `.company/cooler/` with an Overheard list. Nothing is built.
- **A direction, not a spec.** `/aico:brainstorm <idea>` picks 4 to 8 Roles whose angle matters. They answer in rounds (ideas, debate or moderated) until you say done. You then choose to plan and implement, roadmap, keep it as nice-to-have, or park it. Notes land in `.company/brainstorms/`.

Cooler and brainstorm can lead into each other: `/aico:brainstorm "<file>"` opens a cooler file or reopens an earlier brainstorm.

## 2. Check it

`/aico:research <topic | project | file> [quick|deep]` looks the idea up online before you spend build time. You approve the scope first. Market and tech researchers (and a design researcher for UI topics) search in parallel, and the Product Manager writes one sourced report with a verdict (go, go-with-conditions or no-go), ranked actions and low-hanging fruit. It is read-only. At the end you pick: start the feature, brainstorm on the report, roadmap, or park.

Skip this stage when you already know the idea is feasible and wanted.

## 3. Triage

`/aico:triage <request>` classifies the request by size (XS to L), risk tier (low, medium, high) and type, then recommends the shortest valid route. It builds nothing. You approve at a Brief Gate form (Approve, Change or Stop), and the recommended command starts with your request plus the triage line.

Risk overrides size. Anything touching auth, payments, personal data, migrations or a Contract is high risk and keeps every Gate and the full review lane, however small. You can always choose a longer route than the one recommended. `/aico:lead <request>` runs triage for you when the size is unclear.

## 4. Build with `/aico:feature`

`/aico:feature <feature description>` takes a feature or a new product from brief to shipped. The numbers below match the steps of the Playbook.

1. **Brief.** The Product Manager writes the problem, users, scope, acceptance criteria (each with an ID such as AC1) and the risk tier. **Brief Gate:** you approve. For a low-risk feature the form also offers the short path, which skips some review lanes but keeps every Gate and test.
2. **Plan.** The Architect writes the plan: the Core list, the Contracts between Modules, the Module map and a task list with an S/M/L estimate per Module. A UI designer joins when there is UI. If a design question is risky, the Architect lists a **spike**: a throwaway experiment whose code never enters the product. Persona testers walk the design. The Senior Engineer maps the project's rules, and the Architect signs them off when Must rules changed. **Plan Gate:** you approve Core, Contracts and art direction, and you see the spike results, the plan check and the parallel plan.
3. **Build.** Builders start from the task queue, one task per Module, in parallel up to the parallel cap (default 4). Each builder gets a **task brief**, which is its slice of the plan, so it never reads the whole plan. Each also gets a **rule slice** of 1 to 3 files holding only the rules for its task. Builders work test-first.
4. **Review.** In parallel: the Code Reviewer, QA and the optional lanes: security, compliance, legal (for AI, payments or personal data) and, for UI, hands-on and accessibility testers. Before the reviewers start, tool checks run over the diff and pass their findings along; they never close a review. The Code Reviewer and QA do a **first pass** from the acceptance criteria, the plan, the Contracts and the diff only, write those findings, and only then open the builder's Handoff. This keeps them from copying the builder's own view.
5. **Fix rounds and contests.** Blocking findings go back to the builder. A round is one builder fix plus a re-review by every reviewer that blocked. The default limit is 2 rounds (`pipeline.fix_rounds` in `/aico:settings`); past it, the Lead escalates to you. A builder may instead **contest** a finding with a `## Contested` line; the reviewer that raised it accepts or rejects. A contest the reviewer cannot settle, or an escalated one, comes to you at a Gate, and only your own answer closes it. A security finding is never closed by contest. Nits never trigger a round.
6. **Full suite.** Builders and QA ran scoped tests only. Once the last review is clean, the Lead runs the whole test suite once and quotes the result line.
7. **Docs.** The Writer adds user docs and release notes. The Localizer translates if your project lists more than one language.
8. **Ship Gate.** You see the summary: what changed, test results, open nits, skipped lanes, a cost line. Approve, Change or Stop. Nothing leaves the repo before this.
9. **PR, CI, merge.** After approval the Lead pushes the run branch `aico/<slug>`, opens a pull request, waits for CI on the PR to pass (`gh pr checks <n> --watch`) and merges only when it is green. With the Ship Gate set to `auto`, the Lead opens the PR and stops; you merge it.

Everything is saved under `.company/work/<slug>/`: the brief, plan, one Handoff per Step and a final `00-summary.md`.

### Small changes: `/aico:fix`

`/aico:fix <bug description or issue link>` skips the Brief and Plan Gates, because the bug report is the brief. QA writes a failing regression test, the engineer who owns the Module fixes the root cause test-first, reviewers check, and you approve at the Ship Gate. A fix that needs a Core or Contract change forces a Plan Gate.

## 5. Release

After the merge, cut the release from the repo root:

```
npm run release <x.y.z>
```

The script updates the version and changelog and never pushes. A release carries a `Rollback:` line, an SBOM and a Gate Report. For the release rules, see [Releases](concepts.md#releases).

## Worked example

You want users to export their data as CSV.

1. `/aico:reprompt export user data` sharpens the one-line idea. You answer two questions, pick Use it, and the sharpened prompt goes to the Lead.
2. You are unsure anyone needs it, so you run `/aico:research is there demand for CSV export in small clinic software quick`. The report says go-with-conditions and ranks "export patient list" first. You pick Start.
3. `/aico:triage` reads the request. Patient data is personal data, so it reports `M, risk high, feature` and keeps every Gate and the full review lane. You approve.
4. `/aico:feature` starts. The brief has AC1 (a signed-in admin can download a CSV) and AC2 (the file lists only that admin's clinic). At the Plan Gate you see one Contract (`export`), two tasks (an export Module and a settings-page button) and a legal lane, because personal data is involved. You approve.
5. Two builders run in parallel with their task briefs. The Code Reviewer blocks AC2: a query lacks the clinic filter. One Fix round later the review is clean.
6. The full suite passes. At the Ship Gate you read the summary, approve, and the Lead opens the PR, waits for CI and merges.
7. You run `npm run release 1.4.0`.

## Coming in the next release

> **Not shipped yet.** These items are in development on the Elephant-Goldfish branch. They are not in v0.20 on `main`, and the steps above do not use them.
>
> - **Fresh plan reviewer.** A protected Role reviews the plan with no memory of how it was made, at the Plan Gate.
> - **Comprehension paraphrase.** The reviewer restates the plan in its own words, and the Gate shows that paraphrase, so you can see whether the plan is understood.
> - **Review-loop stop rules.** A record of each review loop, with rules that stop it when it stops making progress.
> - **Contest evidence.** A contest must carry checkable evidence, and CEO rulings and dated exceptions are recorded in files.
> - **Drift report.** `/aico:maintain drift` compares picked Contracts with the code and reports differences. It is informational and never blocks.
> - **Per-task worktrees.** Parallel builder tasks run in separate git worktrees beside the repo and are merged in plan order.
> - **Durable spec.** Each shipped feature leaves a destination spec in your repo, with no file paths and no code.
> - **Prototype step.** A throwaway prototype step for design questions.
