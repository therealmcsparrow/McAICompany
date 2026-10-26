---
step: 27
role: senior-engineer
task: research-team
status: done
round: 1
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
files-touched: [.company/standards/agent-security@2026.md, .company/standards.md]
---
## Did
- Compliance re-check of `git diff d39e8824..HEAD` (Fix commits 8635446, 9fbe21c, 31b01f7). I checked only the lines added or changed for the 7 blocking items in 19. I read the code; I did not run tests. The test, check and validate results below come from 22 and the dispatch.
- 1 [security] Short Topic: resolved. RR `## Short Topic` (docs/contracts/research-report.md:7-11) is an allow-list (`^[\p{L}\p{N}]+([ -][\p{L}\p{N}]+)*$` with the `u` flag, ≤ 60 chars, ≤ 5 words). A failing topic falls back to the slug and is never repaired. skills/research/SKILL.md:48 cites the rule, and :66 re-checks it before the shell and single-quotes the command. Single quotes are safe here because the allow-list rules out `'`, `$`, backticks and newlines. agentsec.M-SEC7 and proj.M1 are met.
- 2 [security] install-skills off Windows: resolved per 21 option (a). In scripts/install-skills.mjs:158-161, :177 and :216, source-built entries get argv when the platform is not win32, run with `execFileSync('npx', argv)` and no shell. win32 and manifest `install` strings keep `execSync`. Tests are at install-skills.test.mjs:256 and :277. node.M-SEC1 is met, and node.M-SEC5 is unchanged.
- 3 [spec] cc.S1: resolved. Every script call in pipeline:18, cooler:76, help:20, version:17, ruleset:85, research:18/62, feature:20 and setup:15 now uses `node "${CLAUDE_PLUGIN_ROOT}/scripts/…"`. The `<plugin root>` that remains (cooler:75, help:10, pipeline:14/16, setup:12, version:13/14) names files to read, not scripts, so cc.S1 does not cover it.
- 4 [test] nodetest.S3: resolved. `tempDirs` and a top-level `after` sit at scripts/check.test.mjs:9-14, and `mkdtempSync` is called only inside `fixture()`. 22 reports the `aico-*` temp-dir count is unchanged after a run.
- 5 [test] proj.M7: resolved. The check.test.mjs comment and the research-playbook.test.mjs:7-8 header no longer name the AC or the task. AC IDs in test titles are still there (nit in 19, not a rule).
- 6 [test] ruleset:85 glued bullets: resolved, now on separate lines. `npm test` is 185/185 at HEAD (22).
- 7 [test] cc.S5: resolved. `claude plugin validate .` printed "Validation passed" with one ICON_MISSING warning, noted in 22. `node scripts/check.mjs` gave 0 errors and 0 warnings.
- Security nit (researchers have full Bash and Write while reading untrusted pages): I added **agentsec.S5 (Should)**, library pack first (`~/.mcsparrow/standards/agent-security@2026.md`), then the copy at `.company/standards/agent-security@2026.md`. Source: OWASP LLM06 (minimize extensions and their functionality) and code.claude.com/docs/en/sub-agents.
- `.company/standards.md` `## Debt`: removed the 8 resolved lines (node.M1, gha.M1, gha.M-SEC1 x2, gha.S1, node.S1, nodetest.M1, agentsec.S1 install-skills.mjs:23). I also removed cc.S1 setup:15, which is resolved by item 3. I did not add the check.test cleanup line because item 4 closed it. I added 3 agentsec.S5 lines and 2 agentsec.M-SEC7 lines (see below).
## Decisions
- agentsec.S5 is a Should, not a Must. It is not exploitable as shown: the attack needs an injection to beat agentsec.M-SEC1/M-SEC3 first, and Security rated it medium confidence. The rule is new, so the agent `tools:` lines that already violate it are Debt, not Blocking.
- Write cannot be limited to the Output path. The sub-agents docs say `hooks` and `permissionMode` are "Ignored for plugin subagents", and `tools` has no path specifier. Researchers need Write for their Handoff, so S5 asks only that the residual Write risk be named in the agent file. The Lead's §5 tree check stays the control for in-repo writes. Writes outside the repo are accepted residual risk until the harness supports path scoping.
- pipeline:42 is a changed line, but the change only adds the `Language:` sentence. The double-quoted `git commit -m` fragment existed before agentsec.M-SEC7 arrived in this run, so it goes to Debt (as in 18), not Blocking. brainstorm:68 is an unchanged line, so it is Debt too.
## Blocking
## Nits
- skills/cooler/SKILL.md:105 puts `<topic-slug>` in double quotes. That is fine only while the slug stays `[a-z0-9-]`. Worth stating the pattern next to it.
- Nits from 19 (anchored language pattern, slug pattern, brainstorm data-not-instructions, AC IDs in test titles, `NAME_RE =/` spacing) were not rechecked. They never block.
## Debt
- agentsec.S5 — agents/market-researcher.md:4, agents/design-researcher.md:4 (drop Bash), agents/tech-researcher.md:4 (drop Bash or name the read-only command it needs; name the Write risk in all three) — S
- agentsec.M-SEC7 — skills/pipeline/SKILL.md:42, skills/brainstorm/SKILL.md:68 — double-quoted LLM summary in `git commit -m` — S
## Next
- Architect: no Must was added or changed. agentsec.S5 is a new Should; please sign off at the next ruleset touch.
- Security's other asks are not done. I did not add a Should on project-scope `npx` using the product's `.npmrc`/`node_modules/.bin` (it needs npm docs research), and the npx cwd line for the Install form is still open. Do one refresh Step, or route both via `/aico:fix` together with the agentsec.S5 Debt.
- Lead: the library file `~/.mcsparrow/standards/agent-security@2026.md` was changed but not committed (CEO's call). `.company/` is git-ignored here (global ignore `.company/*`).
