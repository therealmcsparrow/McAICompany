---
name: review
description: Use when the aico code-reviewer reviews a builder's work. Judges spec match, code standards and Core/Module/Contract rules; sorts findings into blocking vs nits.
---

# Review

**Use** `superpowers:requesting-code-review` (reviewer checklist) or `mattpocock-skills:code-review` if available, scoped to the diff of this run's branch against its base.

**Always also check** the review blockers in `aico:contracts`.

**Fallback:** (1) Does the diff do what the input Handoff/brief asked, no more, no less? (2) Correctness: edge cases, error paths, concurrency. (3) Readability and the repo's conventions. (4) Tests cover the behavior.

**Sort:** a bug, spec miss, Contract violation, missing test or security risk → `## Blocking`. Style or preference → `## Nits`. You never edit code; the finding is your output.
