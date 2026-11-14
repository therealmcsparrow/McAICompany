---
task: P20261114.000001/01-feature
---
# Guards and savers run from one rule table in one engine

Status: accepted 2026-11-14 (Plan Gate, task `P20261114.000001/01-feature`).

One command-hook engine reads one rule table (event, matcher, rule ID, kind, fail mode, timeout) and calls pure rule functions, so every rule is testable on its own by its rule ID with a pass and a block fixture (brainstorm Q-17, Q-23). Guards deny and fail closed in every session; savers only allow or note, fail open and run in the Lead session only. The kind comes from the mod manifest, which the engine checks, so a code edit cannot turn a saver into a guard. Decided at the Plan Gate (CEO): the engine's latency budget is p95 ≤ 250 ms per PreToolUse on win32 (over it is a Nit in release 1), and the CEO off switch `AICO_GUARDS=off` stands guards down in the Lead session only; Step sessions are always guarded. Rules run in one worker thread per call that the engine terminates on a timeout, so a rule stuck in an endless loop is a timeout deny, not a hung hook (plan review 2026-11-14).
