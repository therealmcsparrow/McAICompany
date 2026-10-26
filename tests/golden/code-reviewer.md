---
step: 30
role: code-reviewer
task: research-team
status: done
round: 2
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
acceptance-ids: [AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC23]
---
## Did
- Re-reviewed Fix round 2: `git diff --ignore-cr-at-eol 31b01f7..HEAD` (9db854d, d065902). The real change is in 3 files: .gitattributes (new), scripts/install-skills.test.mjs (+23/-10) and skills/research/SKILL.md (+5/-2). The other two scripts change only from CRLF to LF.
- Ran the checks myself at HEAD: `npm test` 185/185 pass, `node scripts/check.mjs` 0 errors, 0 warnings, working tree clean.
- Round-1 Blocking item:
  - [spec] research/SKILL.md AC16 Language rule: **resolved**. §8 (line 69) says again that `docs` stays English and that the summary after it is written in `Language:`, built only from the checked Short Topic. The literal from the RR Contract is unchanged and the AC5 test still matches it.
- Round-1 nits that were addressed:
  - §1.4 presence check: split into three branches (lines 18-21). The `ERROR` branch now says no form and continue degraded. Resolved.
  - Short Topic file that fails the rule: §8 now says the Lead commits nothing, names the file to the CEO, and the PM rewrites the report at the slug path with Write, never a shell `mv`. Nothing unchecked reaches a shell, and this matches RR line 10 (path and summary built from the checked value only). Resolved, with one follow-up nit below.
  - LF + .gitattributes: resolved. `git ls-files --eol` shows i/lf w/lf for all three scripts. The shebang is now `node\n`. `.gitattributes` sets `* text=auto eol=lf` and marks common binary types.
  - TZ-independent date tests: resolved. `inZone` pins Pacific/Auckland (ahead of UTC) and Pacific/Honolulu (behind UTC). Each test asserts the pin worked (`getUTCDate()` is 21 or 23), so a regression to UTC getters fails on any runner, UTC CI included. The `finally` block restores or deletes `TZ`. Node re-reads `TZ` when it changes at runtime, and the guard assertions prove the pin works here.
- New diff: no spike imports, Core and the Contracts are unchanged, no hard-coded user strings, no shell built from unchecked input. No new Must breaks.
## Decisions
- Approved. The Blocking list is empty.
## Blocking

## Nits
- skills/research/SKILL.md:18-23 — the three outcome bullets and the `Install →` / `Skip →` bullets now sit at the same level. Install/Skip read like extra outcomes, not answers to the form. Indent them under "Printed commands".
- skills/research/SKILL.md:20 — the `ERROR` branch says "continue degraded" but does not say what to record. Name the `degraded:` value (e.g. `degraded: presence check failed`) so the report states it.
- skills/research/SKILL.md:69 — the PM-rewrite path does not say what happens next. The Lead re-checks the new file and then commits it, and the old misnamed file is left uncommitted and named in the summary. Also, the nested parentheses ("(… (`research <Short Topic>`) …)") are hard to read.
- skills/research/SKILL.md:69 vs docs/contracts/research-report.md:10 — "the summary after it is written in `Language:`" can be read as translating the fixed word `research`, but the RR literal keeps it. Say it plainly: the word `research` stays as in RR, and the Short Topic carries the `Language:`.
- scripts/research-playbook.test.mjs:109 — AC16 is only pinned for pipeline. Add an assertion on research §8's Language wording so the round-1 regression cannot come back unnoticed.
- README.md, docs/spec.md, .claude-plugin/marketplace.json, .claude-plugin/plugin.json — still CRLF in the index. Under the new `eol=lf` attribute, the next edit to any of them will show a whole-file diff. Run `git add --renormalize .` once, as its own commit.
- Carried over, still open: pipeline:33 `Design skills:` name filter; research §5 per-path status compare; check.mjs:35 `NAME_RE =/` spacing; language.mjs:82 leftover tmp file; AC IDs in test names.
## Debt
- None new.
## Next
- Lead: the review is approved, so continue the pipeline (QA/security/Gate per the Playbook). Every nit is optional and none of them needs a Fix round.
