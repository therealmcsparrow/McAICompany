# Steps are never resumed, enforced by a mod hook

Status: proposed (Plan Gate, task 2026-11-01 13.49 - Context Cap Enforcement)

While an aico run is active, a mod refuses every model SendMessage (the `session.send` hook answers not delivered) and every resumed subagent spawn (`agent.spawn` with `resume` is denied), failing closed when the run-state call fails (a surface without `$.process`, where no run can be read, passes and relies on the pipeline text), so a Step's context only grows inside one fresh window and every follow-up is a fresh Step with the old Handoff as input. This is hard to reverse because the pipeline text, the over-cap ledger check and the review and Fix grouping all assume no Step is ever resumed.
