# ADR 0076: A cold result beats a cached one, and the cache entry is purged

Date: 2026-11-16. Status: proposed (feature run P20261116.000003/01-feature). Contract: `docs/contracts/step-key.md`.

When a cold run and a cached (or would-be cached) result disagree, the cold result counts, the cache entry is purged for the rest of the run, and both results are logged; tags, the nightly run and the Ship Gate always run cold, and `AICO_COLD=1` alone turns every cache off. A cache may never turn a red into a green, and logging both sides keeps drift traceable. Hard to reverse because the cold path is the only backstop for every later cache built on `step-key`, so weakening it would need a major version and the CEO.
