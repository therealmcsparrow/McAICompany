---
name: planning
description: Use when the aico architect or a builder turns an approved brief into an implementation plan.
---

# Planning

**Use** `superpowers:writing-plans` if available. Save the plan inside the run's work dir, not `docs/`.

**Fallback:** list tasks, each with the files it touches, the Module it belongs to, the Contract(s) it implements or uses, the test that proves it, and its dependencies. Mark which tasks can run in parallel (independent Modules). Keep it to decisions; no code bodies.
