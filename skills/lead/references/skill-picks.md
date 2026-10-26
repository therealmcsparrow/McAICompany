# Skill picks (the Lead's side of `skill-recommendation` v1)

Load when the route has a `skill-researcher` Step. Contracts: `docs/contracts/skill-recommendation.md`, `skills-section` v1, `design-skills-section` v1. The Role recommends and scans; only you add skills, and only after both forms below (agentsec.M-SEC4).

## 1. Dispatch
Use the `aico:pipeline` §2 prompt, so the block carries `Name:`, `Language:` and `Context cap:` like every dispatch. Put the Area in the Goal block as its own line: `Area: stack | product-type | company-type | design` (one value). Read the Area-specific inputs from the Contract. The Role runs the `detect` probe itself and writes `skillspector missing` when the tool is absent.

## 2. After the Handoff
1. Status `blocked` with `skillspector missing` → offer the SkillSpector install form from `skills/skillspector/SKILL.md` (always asked, whatever `gates.installs` says). Recommend nothing meanwhile.
2. Lint: `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-picks.mjs" lint .company/work/<slug>/<NN>-skill-researcher.md` (the path from the dispatch, never typed from Role text). A failing line is dropped and named by number, never repaired. Keep the `record` lines from the output.
3. **Approve form** (never auto): the passing lines, each scan in words (`no-llm scan, 0 critical, 0 high, 1 medium`; `static-fallback` as "static fallback, not an LLM scan"), the rejected list with codes. Approve the set (Recommended) / Change / Skip. Skip writes nothing.
4. **Record** the approved `record` lines: area `design` into `## Design skills`; `stack`, `product-type` and `company-type` into `## Skills`, both with `approved: <today>`. The Role's `approved: pending` is never copied.
5. **Install / Skip form**, only after approval: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-skills.mjs" design --project .company/project.md --dry-run` (group `skills` for the other areas), show the printed commands and the telemetry line, and ask Install (Recommended) / Skip. Only `gates.installs: auto` skips this second form. An `ERROR … line <n>` means install nothing and name line `<n>`. Install artifacts (`.agents/`, `.claude/skills/`, `skills-lock.json`) are never committed; the summary names them with the removal command.
6. Nothing installs unless both forms say yes (AC5).

## 3. Post-install scan
After each skill installs, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillspector.mjs" scan --scope project --skill <name> --json` with `<name>` from a passing lint line. The installed copy may differ from the commit that was scanned. A `findings` (blocking) or `error` result is reported with the removal command; you suggest it and never run it (AC14). Scan mode comes from settings (`skillspector.mode`), never from the Role.

## 4. Never
Pass Role text into a command, a path or a `source`; write a line the lint dropped; rank by downloads or stars; run any removal command.
