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
- [spec] src/x.ts:3 — the empty case is not handled — return early
## Next
- backend-engineer: fix it.
