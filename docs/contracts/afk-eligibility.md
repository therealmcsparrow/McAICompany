# Contract: afk-eligibility v1

Status: draft until plan task T5 (run 2026-11-08 20.27 - Pocock Large Items) builds the provider; T5 removes this line and puts the provider path in backticks.

Provider: scripts/afk-eligibility.mjs (pure, Node built-ins only, no I/O). Exports `classify(tasks)`, `ELIGIBLE` and `CODES`. Consumers: `plan-tasks` v1.8 `check` (lane lines), the tracker sync (`why:<code>` label), the AFK picker. Rationale: docs/adr/0065-plan-tasks-owns-lanes.md.

## Rule
A task is AFK only when its plan block says so explicitly and every check passes. Everything else is HITL. The label is never inferred, never read from a tracker, never set by a setting.

## Input
`classify(tasks)` takes the tasks of one plan in plan order, each `{ id, lane, tier, acs, repeated, depsValid, filesValid, overlaps, items }`:
- `lane`, `tier`, `acs`: the raw field values of `plan-tasks` v1.8 (string or `undefined`).
- `repeated`: true when `lane`, `tier` or `acs` appears twice in the block.
- `depsValid`: `depends-on` present, every ID known, not on a cycle.
- `filesValid`: `files:` valid under the path rule. `overlaps`: its files overlap another task's files in the plan (QA tasks included). `items`: the normalised `files:` items.

## Field values
- `lane: hitl` or `lane: afk <code>`; `<code>` one of `ELIGIBLE`.
- `tier: low | medium | high`.
- `acs: AC<n>[, AC<n>…]`, `n` 1-999, 1-40 items.

## Output
One `{ id, lane: 'afk' | 'hitl', code }` per task, in input order.
- `ELIGIBLE` (an AFK result carries it): `docs-only` (every item ends in `.md`), `tests-only` (every item matches `*.test.*` or sits under `tests/`), `isolated` (no extra check), `mechanical` (no extra check).
- `CODES` for HITL, first that applies, in this order: `unlabelled` (no lane line), `hitl-chosen`, `field-repeated`, `bad-lane`, `no-reason`, `reason-unknown`, `no-acs` (missing, empty or bad `acs`), `deps-unclear`, `files-invalid`, `files-overlap`, `tier-missing`, `tier-not-low` (also a bad tier value), `reason-mismatch` (`docs-only` or `tests-only` with a file that does not fit).

## Properties (tested)
- No input yields `afk` unless `lane` is exactly `afk <code>` with `<code>` in `ELIGIBLE` and no HITL code applies.
- Pure and deterministic: the same input gives the same output; no clock, file or environment read.

## Compatibility
New Contract. A new eligible code or HITL code is a minor bump; a changed order or a removed code is a major.
