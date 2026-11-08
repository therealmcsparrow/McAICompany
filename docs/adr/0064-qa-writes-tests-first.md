# ADR 0064: QA writes the tests first, on by default in feature runs

Date: 2026-11-07. Status: proposed (run 2026-11-07 23.46 - QA Tests First Active; accepted at its Ship Gate). Decided: CEO answer to the brief's Q1, "on by default for every feature run, all tiers; fix runs unchanged".

In every feature run a `qa` plan task writes the failing tests for each build task that has seams, the build task depends on it, and `plan-tasks` v1.7 refuses a plan that lacks one and flags builder edits to QA-owned files, because a Role testing its own code is weak evidence and opt-in alone produced no runs to measure. It is enforced in the scheduler rather than left to dispatch text, so the rule holds whatever a Handoff says; fix runs keep their QA reproduce Step. This number is used, not 0060, because 0060 and 0061 are taken by unmerged branches (`parked/route-names-qa-first`, the frozen steno branch) and a second file under the same number would collide if either is ever read or merged.
