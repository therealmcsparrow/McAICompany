# Contract: context-guard v2.0

v2.0 (task P20261114.000001/01-feature, major, breaking, CEO approved at the Plan Gate 2026-11-14; ADR `docs/adr/0070-cap-in-handoff-mod.md`; shipped: the old guard script is deleted). The handoff mod: the cap becomes the `cap` guard (rule `cap.M1`) of the hook engine (`mod-hook` v1, `hook-event` v1, manifest `cap`, `mod-manifest` v1); the old guard script and its two `hooks/hooks.json` entries are removed. Changes against v1.2:
- Threshold `T` = the snapshot's `threshold` (`aico-settings` v3.0 `pipeline.context_cap`: default 180000, valid 60000-250000, invalid → 180000 with one warning per session naming the bad value). Freeze point `F` = floor(T x 0.9). Constants and both formulas live only in the cap rule module (hooks/rules/cap.mjs); `mods/lib/context-cap.mjs` and `scripts/run-cap.mjs` re-export or read from it; no other production file holds `180000` or `162000` (AC13).
- Bands, per session (the dispatch line `Context cap: <cap> handover <n>` carries `<cap>` = `T` and `<n>` = `F`):

  | Band | Step session | Lead session | Record |
  |---|---|---|---|
  | tokens < `F` | silent, every tool | silent, every tool | nothing |
  | `F` ≤ tokens < `T` (**freeze**) | v1.2 Step branch: only a `Write` of a new Handoff or of one new findings ledger in the run folder; every other tool denied with the v1.2 Step reason; SubagentStop blocks once without a Handoff | v1.2 Lead branch in order: Frozen (session already handed over) → deny all but the MCP tool, `continue:false`; Step running → deny `Agent`/`Task` with the wait reason, other tools pass; else clean point → `contextHandover`, first-freeze deny without `continue:false` | `deny`, `handoff`, `ledger` as v1.2; Lead `handover` event |
  | tokens ≥ `T` (**hand over**) | same as freeze (no further tool is allowed or refused) | as freeze, plus `continue:false` on every deny, so the turn ends; a Step running still writes no Lead Handoff | as freeze |

  At the first freeze deny of each agent (Step) or session (Lead) the engine adds one `systemMessage` for the CEO (`aico cap: …`, design file); it is a CEO note, never model text: the model learns only from the deny reason. Tests at T-1-F boundaries: 161999 silent, 162000 freeze, 179999 freeze, 180000 hand over, 180001 hand over (AC11), each for Step and Lead.
- Order: no active run → pass, whatever `tokens.state` (the guard is a run budget; a transcript read error outside a run never denies). In an active run: tokens `state: 'none'` (no usage row yet) count as 0; then the bands.
- Fail mode **closed** (was open), in an active run only: tokens `state: 'error'`, an invalid snapshot, a crash or a timeout → deny `cap.M1: <error word>` (Lead: no freeze, plain deny). The host supplies `run` when `state` is `error` (`hook-event` v1).
- The off switch `AICO_CONTEXT_GUARD=off` is retired; `AICO_GUARDS=off` (engine, CEO only) replaces it for all guards, in the Lead session only; Step sessions are always guarded (`mod-hook` v1 engine step 1).
- The guard record is `.company/work/<slug>/guard.jsonl` (was `context-guard.jsonl`), same rules, plus the event `guards-off` (`{ v, at, ev: "guards-off", session: <sessionKey> }`, once per session). Every guard's denies, `cap.M1` included, also go to the engine's deny log (`mod-hook` v1 engine step 7), which the guard record does not replace.
- `subagent-stop` moves into the engine's `SubagentStop` entry, same behaviour.
- The 54000 fast path becomes floor(60000 x 0.9) from the cap module; the run is found as in v1.1.

Provider: `hooks/rules/cap.mjs` (rule `cap.M1`), run by `scripts/hook-host.mjs` through the `PreToolUse` and `SubagentStop` entries of `hooks/hooks.json`. Consumers: every Role and the Lead during an active run (they see only the refusals), `skills/handoff/SKILL.md` and `skills/pipeline/references/lead-handover.md`. Uses `lead-handoff` v2.4, `run-state` v3.0 (`runCap`, read-only). History: v1.0 to v1.2 held the guard in a script of its own with the hand-over point frozen per run (ADR 0056, ADR 0069); both are superseded by ADR 0070.
