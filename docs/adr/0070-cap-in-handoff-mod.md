---
task: P20261114.000001/01-feature
---
# The context cap moves into one handoff mod

Status: accepted 2026-11-14 (Plan Gate, task `P20261114.000001/01-feature`). Supersedes `docs/adr/0069-configurable-context-cap.md` and `docs/adr/0047-one-context-cap.md`.

aico's context cap becomes the `cap` guard of the hook engine (the handoff mod), the only code that warns, freezes and hands over, because one enforcer cannot disagree with a second one (brainstorm Q-4, Q-8). The threshold defaults to 180000, has a 250000 ceiling, falls back to 180000 with one warning when invalid, and freezes at 90% of it (Q-6, Q-7, Q-9). It is read from a settings snapshot taken at each Step dispatch rather than frozen per run, so a CEO edit applies at the next Step (Q-15).
