# Parallel Steps

## In short
Independent tasks can run at the same time. A script, not the Lead's judgment, decides which tasks may start now. Tasks that touch the same files never run together. You can force one-at-a-time work with a setting.

## How it works
1. The Architect writes each task with its Role, files, dependencies and a `parallel:` flag.
2. `plan-tasks.mjs` says which tasks may start now.
3. Each builder gets a task brief, not the whole plan.
4. At most `pipeline.parallel_cap` Steps run at once.
5. The Plan summary shows a **Parallel plan** block. **→ Ship Gate** The Ship Gate summary carries the same information.

## Technical details
The Lead starts plan tasks with the script `plan-tasks.mjs` (Contract `plan-tasks` v1.1), not by its own judgment. The script reads the task fields in the plan and says which tasks may start now.

**Goldfish builders and reviewers.** Each builder gets a task brief, not the whole plan: `plan-tasks.mjs brief` writes the task's own block, the plan's Contracts, the plan-wide `Decided:` lines and the sections that name the task to `.company/work/<slug>/tasks/<id>.md`. The code reviewer and QA first judge the diff against the brief's acceptance criteria, the plan and its Contracts, and only then read what the builders wrote about their work, so a builder's own account cannot steer the first pass.

**Task syntax.** The Architect writes each task as a heading under `## Tasks` with four list lines:

```markdown
### T3 ledger par record and parallel verdict
- role: ai-data-engineer
- files: scripts/ledger.mjs, scripts/ledger-par.test.mjs, docs/contracts/token-ledger.md
- depends-on: T1
- parallel: yes
```

`files:` lists every file the task creates or edits, as repo-relative paths. A directory counts only when the task owns everything under it. Globs, absolute paths and `..` are not valid, and a path part that ends in `.` is refused (Windows). `depends-on:` is `none` or task IDs. A dependency on a later task is allowed: tasks run in dependency order, and only a real cycle (a dependency on the task itself included) makes a task run alone. `parallel:` is `yes` or `no`.

**Alone.** A task runs alone, and the plan shows one warning line with the reason (in the Ship Gate summary for feature and fix, which have no Plan Gate), when it has no `parallel: yes`, has `parallel: no`, or has a missing or invalid field (for example an unknown Role, an invalid `files:` list, an unknown dependency, a cycle or a repeated field). Only a task with `parallel: yes` and valid fields can run beside others.

**Overlap.** Two tasks that share a path (compared without regard to case or `\` versus `/`, a directory covering the paths under it) never run at the same time. They run in the order the script visits the tasks: plan order, except that a task moves back after the tasks it depends on.

**The cap.** At most `pipeline.parallel_cap` Steps of a run run at once. The value is a whole number from 3 to 5; the default is 4, and an invalid stored value falls back to the level below (your user value, else 4) with a warning. Set it in `/aico:settings`. A project value counts and it is not a lock. The cap also limits other parallel Steps in a pipeline run (for example the review lanes). Read-only fan-outs (brainstorm, research, cooler, usability-test Personas) are not capped.

**Sequential.** Setting Dispatch (`pipeline.dispatch`) to `sequential` overrides the cap with 1. It is the emergency switch: one Step at a time.

**In the summary.** At a Plan Gate, or in the Ship Gate summary of feature and fix (which have no Plan Gate), the Lead shows a **Parallel plan** block: a first line with the task, marked and alone counts and the cap, one `wave` line per wave (a task that waits shows why: `depends`, `overlap`, `alone`, `barrier` or `cap`), and one `warning` line per alone task. The block never blocks the Gate.

**Out-of-list paths.** Each plan-task Step gets `Task:` and `Files:` lines. Before the commit, the Lead sorts the Step's changed paths. A path outside `Files:` is committed and named to you as extra. A path that belongs to another running task is not committed; the Code Reviewer records it as a `[spec]` blocker. The count of extra plus sibling paths goes to the run's `par` ledger line.

**What is stored.** The run record `.company/work/<slug>/parallel.jsonl` holds task IDs, repo-relative paths, the plan file name, a plan hash, the cap, the mode and UTC times. It holds no Handoff, plan or CEO text. It stays with the run's Handoffs: local where `.company/work/` is ignored. At `ship` the ledger gets one `par` line of four whole numbers (cap, peak Steps at once, tasks that waited for an overlap, out-of-list paths). The ledger stays local to the repository and keeps counts only.

**The verdict.** `/aico:feedback` quotes one `parallel verdict:` line from `ledger.mjs parallel-verdict`. It compares the newest runs on v0.18 with a cap of 2 or more against v0.17 runs, both with at least 2 builder Steps and on the same plan check key and model floor. With fewer than 10 runs on either side (default; `--runs` sets 3 to 50) it says `insufficient (n=<k>)`. It says `pass` only when time minus your wait at Gates is at most 0.75 times the v0.17 value, Fix-round, high-blocker and Gate-reject medians are not higher, spend per AC is at most 1.10 times the v0.17 value, and the out-of-list median is 0. Otherwise it says `fail`. Until it says `pass`, nothing here is shown to save time. The verdict never blocks a Step or a Gate.

**Rolling back.** When the verdict says `fail`, set `pipeline.parallel_cap` to 5 in `/aico:settings`; the verdict line names this step. If the runs already used a cap of 5, set `pipeline.dispatch` to `sequential` instead. Reviewer, QA and Security verdicts and the Gates do not change.

### Worktrees
Off by default. With `pipeline.worktrees` `on` (user level only), `pipeline.dispatch` parallel and a cap above 1, a wave of two or more parallel builder tasks gets one git worktree per task in a folder beside the repo, `<repo>.aico-wt`. The Lead merges the task branches in plan order, runs the full suite once in the main tree and then lets the next wave start. Reviewers see the merged result. A conflict stops the merge as a Blocking finding for the Roles of both tasks; the Lead never edits code and never drops a side. A wave of one task, `sequential` dispatch or the setting off uses the main tree as before.
- **Allow the folder first.** Add `<parent>/<repo>.aico-wt` to `permissions.additionalDirectories` in your user settings. Without it a Step cannot read or edit there. If a Step is denied, the Lead stops the wave and tells you.
- **Rules for Steps in a worktree.** Absolute paths only, `git -C <path>` for git, no `cd` or `Set-Location`, and never `git stash` (all worktrees share one stash list).
- **Allow rules you may add.** Scope them to the folder and the script, in both shell forms: `PowerShell(node <plugin root>/scripts/run.mjs worktree:*)`, `Bash(node <plugin root>/scripts/run.mjs worktree:*)`, `PowerShell(git -C <parent>/<repo>.aico-wt/:*)` and `Bash(git -C <parent>/<repo>.aico-wt/:*)`. Never allow all of git.
- **Clean up.** After ship, block or abort, merged tasks are removed. Any other work, a prototype included, is saved as a patch in `.company/work/<slug>/worktrees/` before anything is deleted. The Lead lists any leftover at every Gate.
- **Ship Gate guardrails.** Two lines: `guardrail files:` (paths swept across tasks, extra paths, archived patches, conflicts) and `guardrail handover:` (Steps that handed over). A prototype commit found in the run branch is a Blocking line. See [Releases and git](releases-and-git.md) and `docs/contracts/run-guard.md`.
