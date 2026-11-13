# The Lead records wave, Gates and run end in a run-state file

Savvy must show the wave, the Gates passed and the run's elapsed time, and Reflect must know when a run ends, but no file on disk holds any of that: Handoffs carry Steps, Roles, status and Fix round only, and `00-lead-state.md` is written only near the Lead's context budget. So pipeline Core gains four fixed commands (`run-state.mjs start | wave | gate | end`) that append counts and enums to `.company/work/<slug>/run-state.jsonl` (`run-state` v1); the mods only read it. This is a Core change approved at the Plan Gate, and it is hard to reverse because Savvy, Reflect's retrospective and the active-run scope of Cache Tax and Blast Radius all key on it.

Amended 2026-11-12: Blast Radius was removed (ADR 0068); the other consumers stand.
