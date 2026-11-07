# Plans

## In short
Before building, the Architect writes a plan: a list of tasks. aico checks the plan for choices left open, sizes each task so it fits in one fresh window, and makes sure tests can attach. Tests must fail when the behaviour breaks.

## How it works
1. The Architect writes tasks with fields: Role, files, dependencies, parallel, context size, slice and seams.
2. A text-only plan check lists choices the plan left open.
3. The fresh reviewer reads the plan as a newcomer (see [Review](review.md)).
4. You see the results in the Ship Gate summary. **→ Ship Gate**
5. Builders write tests at the named seams, one slice at a time, red before green.

## Technical details
### Plan check
Before the builders start, the Lead runs a text-only check on the plan file. Feature and fix have no Plan Gate; the result goes to the Ship Gate summary. It lists choices the plan left open. It reads no model and changes nothing in the plan.

**What it looks at.** Only lines under a `##` or `###` heading that starts with Steps, Tasks, Wave, Phase, Fix round, or `T` or `M` and a number such as `T1` (any case). Lines in code fences, inline code, blockquotes and `Decided:` lines are skipped. A line is a finding when it holds `TBD` or `TODO` (whole word, capital letters), `decide later` (any case), or ends in `?` and contains ` or `. One finding per line. A code fence that is never closed is also a finding, because it hides the rest of the plan.

**What you see.** A **Plan check** block in the Ship Gate summary: `plan-check (<policy>): <n> open decision[s], <d> decided`, then up to 5 rows `file:line | phrase | why`, then `+<k> more` if there are more. With zero findings the block still shows, so silence never means the check was skipped. The block is plain text for a screen reader. Under `warn` (the default) the check never blocks. Under `block`, the scripts refuse the build start and every task start while decisions are open; in feature and fix you get one Fix / Stop form, and no answer overrides the refusal (see [The hook Gate](gates.md#the-hook-gate)). With policy `off` no scan runs and the run is marked check-off.

**`Decided:` lines.** When the Architect settles a choice that was open or debated, the plan gets its own line: `Decided: <choice> because <reason>`. Only that full shape is skipped by the check; `Decided: A or B?` is still a finding. Builders cite the `Decided:` lines under `## Decisions` in their Handoff.

**Waving off a warning.** Where a Playbook still has a Plan Gate and shows findings, its form adds the question "Plan check: mark warnings as noise" with the options "None (Recommended)", "All <n>" and a count through Other. The Lead records the number. Feature and fix have no Plan Gate and so no such question.

**What is stored.** One file per run, `.company/work/<slug>/plan-check.jsonl`, with counts, enums, the plan file name and times only. No plan text, no phrase and no CEO text. It stays with the run's Handoffs: committed only where the product tracks `.company/work/`, otherwise local. Before the Ship Gate the Lead reads it and shows a line `plan-check marker: <state>` if the check did not run; this never blocks. The ledger and Handoff frontmatter are not changed.

**The verdict.** `/aico:feedback` compares the median [Fix rounds](review.md#fix-rounds) of the newest check-on runs with the same number of earlier runs (check off, or from before the check). The number of runs is Verdict runs in [settings](settings-and-locks.md), default 5. It says `pass` only when the check-on median is at least 1 lower, `fail` otherwise, and `insufficient (n=<k>)` when either side has too few runs. On `fail` the line adds `default should become off`; nothing changes by itself. It also shows the share of warnings you waved off and adds `retune` above 30%. Until it says `pass`, treat the check as a trial: it is not shown to reduce Fix rounds.

**How a run's Fix rounds are counted.** A Fix round is a builder sent back for a Blocking review or QA finding after the plan exists and before your first answer at the Ship Gate. Work after a changed Ship Gate does not count. The number is the `fix_rounds` value in the run's ledger `ship` line, and a run is used only when the highest `round:` in its Step Handoffs up to that Gate gives the same number. Runs where the two differ, or that have no ledger value, are left out and the verdict line shows a warning count.

**History scan.** `plan-check-verdict.mjs history` runs the check over past plans in the working tree and in git history, read-only, and prints findings to the terminal. It writes nothing to the repository or `.company/`. A person supplies true and false labels in a file to get a false-positive rate.

### Plan tasks: sizes, slices and seams
The Architect gives each plan task three more lines, which `plan-tasks check --handover` checks (`plan-tasks` v1.3).
- `context: <n>k` is the estimate of the task Step's peak context. One task is one fresh window, handed over at 85500, 90% of the fixed 95000 cap, so an estimate above that handover is an ERROR.
- `slice: <trigger> → <observable result> — demo: <path>` names one behaviour a user can see end to end through every layer the task touches. A task that names only a layer (all data, then all API) is an ERROR. A wide refactor may use `slice: wide-refactor — <reason>` and shows as a warning.
- `seams: <path>[#symbol], …` lists where tests attach, or `none — <reason>` for a task with no testable code. Builders test at those seams, one slice at a time, red before green, without writing all tests first.

**Tautological tests.** A test must fail when the behaviour breaks. A test that asserts its own setup, restates the code under test, mocks the unit under test or only checks that a mock was called is a Blocking `[test]` finding.

### QA-first in feature runs
In every feature run, at every tier, the Lead passes `--qa-first` on `plan-tasks check` and `begin` (`plan-tasks` v1.7). You cannot switch it off. `fix` runs and every other Playbook never pass it.
- A **QA task** has `role: qa`; its `files:` are the test files it owns.
- A **build task** is any other task with testable code. It must list at least one QA task in `depends-on`, so QA writes the failing tests first.
- One owner per test file: a task that is not a QA task may not list a QA task's files, and two QA tasks may not overlap.

`check` prints one `ERROR <id>: <reason>` line per problem and exits 2. `begin` refuses with `refused: <q> qa-first errors` and writes nothing. `done` is refused with `refused: qa-owned paths` while the task's latest `out` event lists a path a QA task owns; the builder reverts it and puts the needed test change in a Blocking `[test]` line of its Handoff. Builders may still write unit tests of their own; those are not verification.

### Destination spec
For a feature run, the Product Manager writes `docs/specs/<slug>.md` after the writer: Problem, Solution, User stories, Decisions, Testing decisions and Out of scope, with the ship date and version stamped after you approve at the Ship Gate. The spec has no file paths and no code blocks; `spec-check` reports an ERROR for either, and the Product Manager revises once. Plans keep their paths. For a client project the spec goes into the client's repo only when `.company/project.md` says `spec_in_repo: yes`; otherwise it goes into the `aico:client handoff` package. If the line is missing the Lead asks you first, with `no` as the recommended answer.

### Prototype, glossary and ADR drafts
Feature has no Brief Gate and no Plan Gate. The Product Manager may add one prototype question and proposed `GLOSSARY.md` entries and ADR drafts to the brief. Each is a form when it arises. You choose Run it or Skip for the prototype. Run it uses a worktree on a throwaway branch, the Ship Gate summary shows `prototype: <first line of the answer>`, and the Ship Gate blocks if a prototype commit reached the run branch. The glossary and ADR lines are shown with a `> ` prefix in one form, Write them / Skip; the Architect writes them only after Write them. A product with no `GLOSSARY.md` gets a separate question, Create GLOSSARY.md: Yes / No (Recommended).
