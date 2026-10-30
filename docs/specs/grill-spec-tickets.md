---
slug: grill-spec-tickets
version: 0.22.0
shipped: 2026-10-30
---
## Problem
To grill an idea, draft a spec or cut tickets, the CEO has to start a full feature run, with its branch, builders and Gates. Before he commits to a build he wants to think an idea through, see it as a spec and see it as a task plan, without anything being built. Each of those outputs should then feed the next command and, in the end, a feature run.

## Solution
Three CEO-only commands, each usable on its own, chained by their outputs:
- aico:grill asks the CEO about an idea, one question per form, until no open branch is left or the CEO says stop. Every answer is saved to the grill file in the run's local work folder before the next question, so a crash loses at most one question, and aico:grill resume continues from the open branches. Facts the code or docs can answer are looked up and cited, never asked. At the end a form offers aico:to-spec (recommended), aico:feature or stop.
- aico:to-spec turns an idea, a grill or a file into a destination spec draft (version and shipped both pending) in the local work folder. Only a Product Manager brief Step and a spec-draft Step run. The draft must pass spec-check; one fix round, then it is marked not ready.
- aico:to-tickets turns a spec or a brief into a task plan per plan-tasks v1.3, checks it with plan-tasks and plan-check, prints the task DAG and saves the plan locally with its base commit. One Architect fix round on an ERROR, then not ready.
- aico:feature accepts any of these drafts as input, but every Gate still runs and the plan is checked again against the current base. Stale files are Blocking.
Nothing is built, branched, committed or pushed by the three commands. Ships in release v0.22.0.

## User stories
- As the CEO, I can grill an idea one question at a time, each with a recommended answer and a one-line reason, and see how many answers are done and how many branches are still open.
- As the CEO, I can stop a grill and resume it later without losing more than one question.
- As the CEO, I can turn a grill or an idea into a spec draft that already passes spec-check, or see exactly why it does not.
- As the CEO, I can turn a spec or a brief into a task plan and see each task's Role, files, dependencies, context, slice and seams before I approve any build.
- As the CEO, I can start a feature run from any of these drafts and still approve the brief and the plan myself at the Gates.
- As the CEO, I can ask any of the three commands for help and get its entry without anything running.
- As a CEO of a research, marketing or design company, I can grill an idea; spec and tickets are refused with the standard type line.

## Decisions
- Risk tier high: the work touches Contracts (destination-spec v1.1, plan-tasks v1.3 consumers, company-type v1.5) and the grill file may hold personal data (brief Decisions).
- Grill works in all four company types; to-spec and to-tickets only in software (Brief Gate 3, AC46).
- Spec drafts live only in the local work folder and are never committed or stamped; only a feature run's own step 5a writes the shipped spec (Brief Gate 3, AC35; plan Decided R-8).
- to-tickets approves nothing. Approval happens only in a feature run, where the Brief Gate and Plan Gate always run and no earlier approval carries over (brief Decisions, AC44).
- Release label v0.22.0, since three new commands are new features (CEO at this run's Brief Gate; plan source line).
- All three commands are CEO-only and never start on their own or because a file asks (plan Decided, CEO Plan Gate).
- Grill follows the grilling method: empty frontier, recommended answer first, facts looked up and logged as F entries; questions are asked in the main session by the Lead, one per form (brief Decisions; plan Decided).
- After each answer the Lead rewrites the grill file whole, so its sections stay consistent and a crash loses at most the question in flight (plan Decided, AC42).
- Outside software, the grill end form offers the company's first work Playbook with a request the Lead writes, never the grill file itself (plan Decided R-5).
- CEO text, paths included, never enters a shell argument; it is written to a file first and checked there (plan Decided R-1).
- File inputs are copied once into the run folder and Roles read only the copy, so no link can be swapped in between check and read (plan Decided).
- New run folders never reuse a folder that holds earlier work other than drafts; a feature run started from a draft always gets a fresh run slug (plan Decided R-7, R-10).
- Draft intake in a feature run covers only grill, spec and plan drafts; research-report and brainstorm hand-overs and triage requests start a feature run exactly as today (plan Decided R-12, CEO Plan Gate).
- At the feature Plan Gate, stale plan files are Blocking, changed files are info, and a plan whose base cannot be checked is one Blocking; each closes with a Decided line in the run's plan (plan Decided R-13, R-14).
- The grill file is local and git-ignored, falls under the archive rule and is named in the docs under GDPR data minimisation (brief Laws).

## Testing decisions
- Each of AC35 to AC46 has at least one test; the tier is high, so none is covered lightly.
- Fixtures: a spec draft with a file path (AC36), a linked or outside-root input file (AC37), a brief without criteria (AC39), a grill form with more than one question (AC40), a stale plan given to a feature run (AC44).
- Argument handling is tested with quotes, command substitution, backticks, semicolons, spaces and absolute paths; none may reach output (plan Decided R-1).
- Grill branch text with line or format control characters is refused (plan Decided R-2); slugs at the length limit and with only symbols stay valid (plan Decided R-3).
- Slug picking is tested against a shipped spec and a client run's spec, both of which must get a fresh folder (plan Decided R-10).
- The stale check pins its exit codes for an unknown base, a missing file and any other failure (plan Decided R-14).
- Help tests pin each command's entry, Help and Type lines, argument hint, README row and help listing (AC45).
- Success metric: share of feature runs started from a grill or to-spec output that pass the Brief Gate with no Change round. Read in aico:feedback after 5 such runs; target at least 3 of 5. Guardrail, reported only: median grill questions per session.

## Out of scope
- Tracker or GitHub issues from to-tickets (later, roadmap).
- A Plan Gate or plan reviewer inside to-tickets.
- Committing a draft spec; grill writing a glossary or ADRs (it may propose them).
- Batched or questionnaire-style questions; a questionnaire command (later).
- A wayfinder across several grills (later, roadmap).
- Any build, branch, commit or push from the three commands.
- to-spec and to-tickets outside software companies.
