---
step: 26
role: security
task: research-team
status: done
round: 1
base-commit: d39e8824d81e98a0a3333119ce71881a5716bd0b
risk-tier: high
---
## Did
- Re-checked the Fix-round diff `8635446~1..HEAD` (13 files, compared with `--ignore-cr-at-eol` because the raw stat is inflated by line endings). Read inputs 18, 21, 22 and 23. Applied proj.M1–M4, agentsec.M-SEC7, node.M-SEC1/M-SEC5 and cc.S1 to the added and changed lines only.
- **The Blocking item from 18 is closed.** `docs/contracts/research-report.md:7-11` replaces the block-list with an allow-list, `^[\p{L}\p{N}]+([ -][\p{L}\p{N}]+)*$` with the `u` flag, plus 60-character and 5-word caps. A failing topic falls back to the slug `^[a-z0-9]+(-[a-z0-9]+){0,4}$` and is never repaired. The Lead re-checks it before any shell use, and the commands use single quotes.
  - In `skills/research/SKILL.md`, §4 (:48) cites that rule. §8 (:65) re-checks the topic from the file name and builds `git add '<report path>' && git commit -m 'docs: research <Short Topic>'` from the checked value only.
  - The allowed set has no `'`, `$`, backtick, `\` or newline, so nothing can break out of the single quotes. It cannot start with `-`. It excludes Unicode format characters (Cf, e.g. U+202E bidi overrides) and marks. The frontmatter `topic:` is explicitly kept out of the shell. The fixed path parts (`.company/research/YYYY-MM-DD HH.MM - `) also contain no quote.
  - The regex is linear: every repeat needs a separator, so it has no overlapping quantifiers (proj.M3).
- **`scripts/install-skills.mjs` argv path: no new issues.**
  - `plan` calls `commandFor` (:177) before `argvFor`, and `commandFor` checks `source` against REPO_RE/`validRepo` and `name` against NAME_RE/MANIFEST_NAME_RE, throwing on failure. Both regexes require a first character in `[A-Za-z0-9]`, and the repo part cannot start with `-`. So no argv element built from data can be read as an npx or skills CLI option.
  - `-s` gets a bare `*` and no shell runs. The default exec (:216) uses `execFileSync('npx', argv, { cwd, stdio: 'inherit' })` without `shell: true`. node.M-SEC1 is met off Windows.
  - Manifest `install` strings, and DS `command` sources (byte-identical to one), never get `argv` and keep the existing `execSync`, as ADR 0005 / node.M-SEC5 allow. win32 is unchanged.
  - PATH lookup of `npx` is the same as before. The `cwd`/`.npmrc` exposure from 18 is unchanged, neither better nor worse.
  - Tests cover linux/win32 plans, the bare `*`, project scope without `-g`, and `runAll` pass-through.
- `validDate` now uses the local day. That has no security effect: dates are still checked with `Date.UTC` round-tripping first.
- The `${CLAUDE_PLUGIN_ROOT}` changes in cooler, feature, help, pipeline, research, setup and version are double-quoted fixed env paths, not data. This clears the cc.S1 nit from 18.
- Secrets: grepped the diff for key, token, password and private-key patterns. The only hit is the existing `SECRETMARK` test marker.
- Dependency audit: 0 npm dependencies and no lockfile, so nothing changed since 18. No criticals and no known-exploited vulnerabilities.
## Blocking
## Nits
- skills/research/SKILL.md:65 — if the PM writes the report under a file name that fails the allow-list, §8 uses the slug for the summary, but the `git add` path built from the slug won't match the real file. A Lead might then "fix" it with `mv "<hostile name>"`, which puts the raw value back into the shell. Fix: on failure, commit nothing, name the file to the CEO, and have the PM rewrite the report at the slug path through Write (no shell). Confidence: medium.
- skills/research/SKILL.md:65 / RR:10 — the Short Topic re-check is an instruction to an LLM, not code. A defence-in-depth option: a tiny `node scripts/research-topic.mjs` validator, or have the Lead pass the path to git through argv rather than a shell string. Not required by any Must.
- The off-Windows `execFileSync` path has no integration test, because every test injects `exec` (see 22). A CI step on ubuntu running `install-skills.mjs --dry-run` would not exercise it either. Accept this, or add a test that stubs only `execFileSync`.
## Debt
- Still open from 18: double-quoted `git commit -m` in skills/brainstorm/SKILL.md:68 and skills/pipeline/SKILL.md:42; no SECURITY.md and no SBOM step in CI; agentsec rule for web-reading Roles that have Bash and unrestricted Write; unpinned `impeccable` (agentsec.S1); check.mjs not rejecting a repo part that starts with `-`.
## Next
- Lead: Security has no Blocking items for round 1 and the Security Gate can pass. Carry the Debt and 18's Next items (Senior Engineer: agentsec Must; Lead: SECURITY.md + SBOM follow-ups) into `.company/work/research-team/00-followups.md`.
