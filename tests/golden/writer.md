---
step: 31
role: writer
task: research-team
status: done
round: 0
base-commit: d065902
risk-tier: high
acceptance-ids: []
files-touched: [CHANGELOG.md, documentation/commands.md]
---
## Did
- `CHANGELOG.md` 0.9.0: new `### Fixed` section (before Rollback) with four bullets: report names checked before use (allow-list, slug fallback, commit only from the checked name); presence check error branch (show, install nothing, no form, continue); design-skill dates checked against the local day; plugin script paths quoted and off-Windows `npx` run without a shell. Development bullet gains the LF line-ending note (`.gitattributes`).
- `documentation/commands.md` `### /aico:research`: step 2 states the presence-check error branch; "You get" states the commit summary form, the Short Topic rule and the Lead's re-check outcome.
- Not added: agentsec.S5 (internal Ruleset Should, not user-facing). `.gitattributes` appears only as the Development note.
- Checked against code: `scripts/install-skills.mjs:42-49` (local-date `validDate`), `:242` ("All skills already installed."), `:251` (ERROR path, returns 1 before any install), `skills/research/SKILL.md` §1.4, §4, §8, `docs/contracts/research-report.md` Short Topic.
- Nothing committed.
## Decisions
- Fixed section placed under 0.9.0 (0.9.0 is the unreleased entry being updated, not a new version).
- Kept the change list to user-visible behaviour; install-argv and test-only fixes are summarised in one clause each.
- The `aico:writing` skill named in the Role brief is not in the installed skill list, so the voice check was done by hand against the existing CHANGELOG style.
## Blocking
- [test] `node scripts/check.mjs` and `npm test` were NOT run: this Step had no shell tool (Bash unavailable). Lead must run both. Expect 0 errors and 0 warnings from check, and 185 pass / 0 fail from npm test (per 22 and 28). The check counts `CHANGELOG.md` vs `plugin.json` vs documentation, so the new `### Fixed` heading must not break the parser; that is unverified.
## Nits
- `CHANGELOG.md` 0.9.0 Added still reads "Only the report is committed" with no commit form; left as is.
## Next
- Lead: run `node scripts/check.mjs` and `npm test` (from the repo root). Route any failure to the owning Role by file.
- Lead: commit is the Lead's call; nothing was committed by the writer.
