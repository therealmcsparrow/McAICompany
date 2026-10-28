# 0033: A script picks the parallel plan Steps, not the Lead

Status: accepted (Plan Gate 2026-10-28)

Parallel builders in one tree broke each other's work when the Lead chose "every independent builder" by judgment, so v0.18 makes the choice a pure function of the plan text, the committed set and `pipeline.parallel_cap` (`scripts/plan-tasks.mjs next`, `plan-tasks` v1), with unmarked or unclear tasks running alone and overlapping tasks running in plan order. The run's start and done events live in `.company/work/<slug>/parallel.jsonl` next to the Handoffs, and only four integers reach the ledger (`token-ledger` v1.3 `par`), so the record is reproducible and the ledger stays counts-only. Hard to reverse because the plan task syntax becomes a format every later plan and the planning skill depend on.
