---
step: 25
role: qa
task: research-team
status: done
round: 1
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
acceptance-ids: [AC18]
files-touched: []
---
<!-- Saved by the Lead: QA could not write this file in its session. Content verbatim from QA's report. -->
## Did
- Blocking item: `skills/ruleset/SKILL.md:85` now has "Library missing on this machine → recreate it..." on its own bullet line, so AC18 is fixed. The AC18 test in `scripts/research-playbook.test.mjs` passes.
- `npm test`: tests 185, pass 185, fail 0. `node scripts/check.mjs`: 0 error(s), 0 warning(s).
- Local-date window tests (00:30, 01:59 accepted; 23:30 tomorrow refused, for approved and vetted) are meaningful.
- Argv-off-Windows tests (exact argv on linux incl. `-s '*'`, none on win32 or manifest install strings, exec spy cwd, runAll pass-through) are meaningful.
- Temp-dir cleanup in `scripts/check.test.mjs` via tracked roots and an `after()` hook.
- Short Topic commit form pinned single-quoted; double-quoted commit asserted absent.
- `scripts/install-skills.test.mjs` and `scripts/research-playbook.test.mjs` show ~800 changed lines each: a line-ending rewrite, not new behaviour.
## Decisions
- None.
## Blocking
- None.
## Nits
- Short Topic and commit-form tests are pinned text: they catch removal or drift, not what the Lead actually runs.
- Date-window tests need a non-UTC test time zone to catch every regression; the pair is adequate.
- Still no live dry-run of `/aico:research`; AC16 Dutch commit subjects are text rules only.
## Next
- Lead: Ship Gate once the other reviewers pass.
