# ADR 0075: ui_changed is true unless a change touches only docs or tests

Date: 2026-11-16. Status: proposed (feature run P20261116.000003/01-feature). Contract: `docs/contracts/diff-facts.md`.

The `diff-facts` flag `ui_changed` is `false` only when every changed path is docs or tests; locale, theme, token, CSS, config, rename-only, binary, unknown paths and an empty diff all give `true`, and a repo config may only narrow what counts as docs. A wrong `false` skips the a11y job and the UI Roles at once and ships a barrier, while a wrong `true` costs one job or Step, so every doubt falls on `true`. Hard to reverse because three gates (CI a11y job, Role skips, merges) read the one flag, and loosening it later needs a major `diff-facts` version and the CEO.
