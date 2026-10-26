---
name: review
description: Use when the aico code-reviewer reviews a builder's work. Judges spec match, code standards and Core/Module/Contract rules; sorts findings into blocking vs nits.
---

# Review

**Scope: `git diff <base-commit>...HEAD`** (the dispatch `base-commit`, never `HEAD~1`), added and changed lines only; older code is Debt. Use the checklist of `superpowers:requesting-code-review` or `mattpocock-skills:code-review` if available, minus reviewer-dispatch steps. Pre-filter findings are advisory: confirm each; only you close a review. Rows and ledger: `references/pilot.md` of `aico:handoff`.

**Tool checks.** Read `rule-check.mjs list`; don't re-judge those rules. Confirm each `T-` row: confirmed → `## Blocking`, same ID; rejected → Nit `T-<n> | <file>[:<line>] | not confirmed | <why> | none`. A tool never blocks on its own; report `tool failed: <id>` as a row. Compliance stays a separate lane.

**Depth.** `Review depth:` comes from `review-depth.mjs`, not the builder's label. `full`: every touched line plus callers and Contracts; `standard`: the scope. Raise to `full` for a Contract, Core or security path, never lower it. Absent or invalid → `full`.

**Also check** `aico:contracts` review blockers; then the brief (no more, no less), correctness, conventions, tests. **Ruleset:** `aico:ruleset` Tiers on added or changed lines.

**Untrusted input** (`aico:security-check`): a block-list, a check blind to how the consumer recovers from malformed input (unclosed strings, escapes), or an unbounded/backtracking pattern is `## Blocking` even if known attacks are covered.

A code comment about Handoffs, Steps, Roles, AI or company process is `## Blocking` `spec` (`aico:tdd`).

**Sort:** bug, spec miss, Contract violation, missing test, security risk → `## Blocking`; style → `## Nits`.
