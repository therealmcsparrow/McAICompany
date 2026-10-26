---
step: 21
role: architect
task: research-team
status: done
round: 1
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
files-touched: [docs/contracts/research-report.md]
---
## Did
- Edited `docs/contracts/research-report.md`. Line 4 now points to a new `## Short Topic` section, and line 5 adds a version note. The section adds the allow-list, the slug fallback, the rule that the Lead re-checks the topic before any shell use, and the single-quoted `git add`/`git commit` form. I also added an error case. The Report, Handoff-extension and heading text is unchanged, so the `scripts/research-playbook.test.mjs` assertions on this file still match.
- Read 16, 18 and 19, `scripts/install-skills.mjs:145-245` and node.M-SEC1/M-SEC5 in `.company/standards/nodejs@26.md`.
## Decisions
- (a) research-report stays **v1** (revised 2026-10-22). This is an additive tightening, so no Plan Gate flag is needed: every topic the new rule accepts was valid before, and consumers still read older report files. The rule: `^[\p{L}\p{N}]+([ -][\p{L}\p{N}]+)*$` with the `u` flag, ≤ 60 chars, ≤ 5 space-separated words, Title Case. A topic that fails is replaced by the run slug `^[a-z0-9]+(-[a-z0-9]+){0,4}$`. It is never stripped, repaired or used raw. I chose Security's fallback over Senior's "rebuild from allowed chars" because the fallback gives the same result every time and the Lead has no repair logic to get wrong.
- (b) **Code fix (option a)**. node.M-SEC5 is not widened. The fix is small and keeps the Must as strict as it is now. Windows needs the shell only because `.cmd` shims require it, and that reason does not apply on Linux/macOS. Widening the rule would let every future one-string call off Windows rely on allow-lists alone. Not hard to reverse, so no ADR.
- Builder spec for (b), `scripts/install-skills.mjs`:
  - `commandFor` keeps returning the display string `cmd`, unchanged (logs, dedup key, `ok`/`failed` and existing tests stay the same). For entries built from `source` (no `install` string) with `platform !== 'win32'`, the plan item also gets `argv: ['-y', SKILLS_CLI, 'add', source, '-s', skill, ...(scope === 'project' ? [] : ['-g']), '-a', 'claude-code', '-y']`. In argv the wildcard is a bare `*`, never `'*'`, because no shell strips the quotes.
  - On win32, and for every manifest `install` string (repo-owned; a DS `command` source is byte-identical to one), there is no `argv`, and the current `execSync(cmd)` path stays as it is.
  - `runAll` passes `item.argv` through: `exec(cmd, cwd, argv)`. The default exec runs `argv ? execFileSync('npx', argv, { cwd, stdio: 'inherit' }) : execSync(cmd, { cwd, stdio: 'inherit' })`. Never `shell: true`.
  - Tests (test first): with `platform: 'linux'`, a design entry and a user-scope source entry produce the exact `argv` above, the exec spy receives it, and a `*` name gives a bare `*`. With `platform: 'win32'`, the item has no `argv` and `cmd` is unchanged. A manifest `install` entry never gets `argv` on any platform.
- Compliance after (b): node.M-SEC1 is met off Windows. node.M-SEC5 still covers win32 exactly as written. agentsec.M-SEC7 and ADR 0005 are unchanged.
## Blocking
## Nits
- `skills/research/SKILL.md:34` dispatches with "research-report v1". That still matches, so nothing to change.
- The double-quoted `git commit -m` Debt in `skills/brainstorm/SKILL.md:68` and `skills/pipeline/SKILL.md:42` (18) can reuse the same rule: checked value, single quotes.
## Next
- ai-data-engineer: in `skills/research/SKILL.md`, make §4 (:48) state the RR `## Short Topic` rule in place of the block-list, with the slug fallback, and have the PM dispatch cite it. Make §8 (:66) use `git add '<report path>' && git commit -m 'docs: research <Short Topic>'` built only from the checked value. Security then re-checks :48/:66.
- backend-engineer: carry out the (b) spec above in `scripts/install-skills.mjs` and its tests.
- Senior Engineer: nothing to amend in node.M-SEC5.
- Lead: run `node scripts/check.mjs` and `npm test` after the Fix round.
