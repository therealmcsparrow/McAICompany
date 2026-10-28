---
name: planning
description: Use when the aico architect or a builder turns an approved brief into an implementation plan.
---

# Planning

**Use** `superpowers:writing-plans` if available, for the plan format only. Save the plan inside the run's work dir, not `docs/`, and stop after writing it: skip its execution hand-off. The Lead decides execution.

**Fallback:** list tasks, each with the files it touches, the Module it belongs to, the Contract(s) it implements or uses, the test that proves it, and its dependencies. Keep it to decisions; no code bodies.

**Tasks (plan-tasks v1).** Every task is a heading `### T<n> <title>` under `## Tasks`, with four list lines: `- role: <agent slug>`; `- files: <repo-relative paths, comma-separated>` (every file it creates or edits; a directory only when the task owns everything under it; no globs, absolute paths or `..`); `- depends-on: none or T<n>, T<m>` (a later task is allowed: tasks run in dependency order; only a real cycle, a dependency on itself included, makes a task run alone); `- parallel: yes or no`. A shared hot file (CHANGELOG, package.json, a Contract doc, an index) belongs to one task only. A missing or invalid field, or `parallel: no`, makes the task run alone; tasks that share a path run in plan order. The Lead shows the resulting waves at the Plan Gate.

**Settle every choice** under the plan sections the Plan Gate check reads (Steps, Tasks, Wave, Phase, Fix round, T<n>, M<n>): no `TBD`, `TODO` or `decide later` there (the Plan Gate check lists them). A settled choice that was open or debated gets its own line `Decided: <choice> because <reason>`. Builders cite those lines under `## Decisions`.
