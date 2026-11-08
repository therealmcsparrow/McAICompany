# 0065 The plan-tasks Module keeps the task syntax; lanes are a v1.8 minor

Status: proposed (Plan Gate, task 2026-11-08 20.27 - Pocock Large Items). Contracts: `docs/contracts/plan-tasks.md` (v1.8 draft section), `docs/contracts/afk-eligibility.md`, `docs/contracts/wayfinder.md`.

The brainstorm said the wayfinder would own plan-task v1 with no Contract change, but `plan-tasks` v1.7 is installed and owned by the plan-tasks Module. The HITL/AFK lane, tier and AC fields go into `plan-tasks` as an additive v1.8 (old readers see them as prose), the eligibility rule is its own pure Contract `afk-eligibility` v1, and the wayfinder is a new `wayfinder` v1 file format that only reads plan tasks. One owner per syntax keeps the scheduler, the Gate check and every reader on one parser.
