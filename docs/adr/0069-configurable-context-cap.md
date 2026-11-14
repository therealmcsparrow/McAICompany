---
task: P20261112.000001/07-feature
---
# The context cap is a setting, default 180000, handover at 90%, frozen per run

Status: accepted (task `P20261112.000001/07-feature`). Supersedes `docs/adr/0047-one-context-cap.md`.

The context cap is `pipeline.context_cap` (project over user over the plugin default 180000), with the handover point at floor(cap x 0.9), because the CEO wants fewer early hand-overs on large-window models. The value is resolved once at run Setup and recorded with the run, so every dispatch, the context guard, the ledger and the progress views of one run use the same cap even when the setting changes mid-run or the Lead session is resumed. It stays one cap for every Role and every Risk tier: `roles.<role>.context_cap` is still accepted and has no effect.
