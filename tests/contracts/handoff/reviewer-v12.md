---
step: 05
role: code-reviewer
task: sample-task
status: done
round: 0
base-commit: 0123456789abcdef0123456789abcdef01234567
risk-tier: medium
contracts: [handoff v2.0]
---
By: code-reviewer
## Did
- Reviewed the diff.
## Blocking
- [spec] R-1 src/x.ts:3 — the empty case is not handled — return early
## Contests
- none
## Nits
- none
## Next
- backend-engineer: fix R-1 or contest it.
