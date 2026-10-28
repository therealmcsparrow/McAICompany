---
name: planning
description: Use when the aico architect or a builder turns an approved brief into an implementation plan.
---

# Planning

**Use** `superpowers:writing-plans` if available, for the plan format only. Save the plan inside the run's work dir, not `docs/`, and stop after writing it: skip its execution hand-off. The Lead decides execution.

**Fallback:** list tasks, each with the files it touches, the Module it belongs to, the Contract(s) it implements or uses, the test that proves it, and its dependencies. Mark which tasks can run in parallel (independent Modules). Keep it to decisions; no code bodies.

**Settle every choice** under Steps and Tasks: no `TBD`, `TODO` or `decide later` there (the Plan Gate check lists them). A settled choice that was open or debated gets its own line `Decided: <choice> because <reason>`. Builders cite those lines under `## Decisions`.
