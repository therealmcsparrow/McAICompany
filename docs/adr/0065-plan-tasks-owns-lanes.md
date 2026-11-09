# 0065 The plan-tasks Module keeps the task syntax; wayfinder only reads it

Status: accepted 2026-11-08, shipped in release 0.31.0 (Ship Gate, task 2026-11-08 20.27 - Pocock Large Items). Contracts: `docs/contracts/wayfinder.md`, `docs/contracts/plan-tasks.md` (v1.7, unchanged).

The brainstorm said the wayfinder would own plan-task v1, but `plan-tasks` v1.7 is installed and owned by the plan-tasks Module. So `wayfinder` v1 is its own map file format that reads plan tasks only through `parsePlan` (for `#T<n>` anchors) and changes no `plan-tasks` syntax. One owner per syntax keeps the scheduler, the Gate check and every reader on one parser.
