---
name: review
description: Use when the aico code-reviewer reviews a builder's work. Judges spec match, code standards and Core/Module/Contract rules; sorts findings into blocking vs nits.
---

# Review

**Scope: the diff against `base-commit`** from your dispatch (`git diff <base-commit>...HEAD`), added and changed lines only — never `HEAD~1`, never older code (that is Debt). **Use the checklist** from `superpowers:requesting-code-review` or `mattpocock-skills:code-review` if available, applied by you to that diff. You are a subagent and can't dispatch other agents, so skip any step in those skills that dispatches a reviewer.

**Pre-filter findings** may arrive in your input (from `aico:pipeline`'s deterministic pre-run). They are advisory and additive: confirm each against the diff before you keep it, and add your own. The pre-filter never closes a review — only you do.

**Tool checks (AC22).** `T-` rows from `rule-check.mjs run` and the `list` of tool-checked rules come first. Read `list` so you don't re-judge those rules by hand. Confirm each `T-` row against the diff: confirmed → `## Blocking` row with the same `T-` ID; rejected → Nit `T-<n> not confirmed — <why>`. A tool never blocks on its own, and a missing or failed tool (`tool failed: <id>`) is a row you report, never silence. Compliance stays a separate lane.

**Depth (AC24).** The dispatch `Review depth:` comes from `review-depth.mjs` over the touched paths, not the builder's label. `full`: every touched line plus its callers and Contracts. `standard`: the scope above. Raise `standard` to `full` when you see a Contract, Core or security path; never lower it. Absent or invalid → `full`.

**Rows and ledger (pilot, `aico:handoff` v1.1).** One row per finding: `R-<n> | file:line | problem | why | fix`; IDs are stable across Fix rounds and `why` is never empty. Keep `<NN>-code-reviewer.findings.md` open from the first file: add each checked file under `## Checked` and each finding under `## Findings` (`open|fixed|withdrawn`, never deleted). A handover or Fix-round reviewer continues that file and re-checks only the open rows plus the new diff.

**Always also check** the review blockers in `aico:contracts`.

**Fallback:** (1) Does the diff do what the input Handoff/brief asked, no more, no less? (2) Correctness: edge cases, error paths, concurrency. (3) Readability and the repo's conventions. (4) Tests cover the behavior.

**Ruleset:** apply `aico:ruleset` Tiers to added or changed lines; a Must break is `## Blocking`.

**Untrusted input:** validation built as a block-list of bad patterns, a check that ignores how the consumer recovers from malformed input (unclosed strings, escapes), or an unbounded/backtracking pattern is `## Blocking`, even if every known attack is covered (see `aico:security-check`).

**Comments:** a code comment about Handoffs, Steps, Roles, AI or company process (not about the code itself) is `## Blocking` `spec` (see `aico:tdd`).

**Sort:** a bug, spec miss, Contract violation, missing test or security risk → `## Blocking`. Style or preference → `## Nits`. You never edit code; the finding is your output.
