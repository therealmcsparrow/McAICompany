---
step: 22
role: backend-engineer
task: research-team
status: done
round: 1
base-commit: 863544659051feae7aa9f4660d2297c8adbe2fb0
risk-tier: high
files-touched: [scripts/install-skills.mjs, scripts/install-skills.test.mjs, scripts/check.test.mjs, scripts/research-playbook.test.mjs]
---
## Did
- (1) `validDate` now compares against the local calendar day (getFullYear/getMonth/getDate), not UTC. Tests use local-time Dates: 00:30 and 01:59 local accept "today"; 23:30 local refuses tomorrow (approved and vetted).
- (2) Per 21-architect Decisions (b): `plan` adds `argv` for source-built entries when platform is not win32 (bare `*` wildcard, no `-g` for project scope). `cmd` is unchanged. Manifest `install` strings and win32 never get `argv`. `runAll` passes `argv` to `exec(cmd, cwd, argv)`. The default exec runs `execFileSync('npx', argv, {cwd, stdio:'inherit'})` when argv is set, else the old `execSync`. No `shell: true`. Tests cover linux and win32 plans, design scope with cwd, the exec spy, and `runAll` pass-through.
- (3) `check.test.mjs`: `fixture` records each temp dir, and a top-level `after` removes them. The "AC14" reference is gone from the comment.
- (4) `research-playbook.test.mjs` header comment no longer names the task or the acceptance criteria.
- Lead's extra item: the AC5 assertion in `research-playbook.test.mjs` now expects the single-quoted `git add '<report path>' && git commit -m 'docs: research <Short Topic>'`, the RR `## Short Topic` rule reference, and no double-quoted `git commit -m "`.
- Tests were written first: 4 new tests failed before the code change.
## Verify
- `npm test`: 185 tests, 185 pass, 0 fail (after the Lead's extra item below).
- `node scripts/check.mjs`: `0 error(s), 0 warning(s)`, exit 0.
- `claude plugin validate .`: `Validation passed`. One directory warning, ICON_MISSING (no plugin icon). It does not change the result.
- Temp dirs: the count of `aico-*` dirs in %TEMP% is unchanged (544) after `node --test scripts/check.test.mjs`. Those 544 are older leftovers; I did not delete them.
- Not tested: the real `execFileSync('npx', ...)` path off Windows. Every test injects `exec`, and this machine is win32.
## Blocking
- None.
## Nits
- `deps/skills.json` is unchanged. Windows keeps the shell path, as node.M-SEC5 allows.
## Next
- Lead: nothing.
