# Skill picks (the Lead's side of `skill-recommendation` v1)

Load when the route has a `skill-researcher` Step. Contracts: `docs/contracts/skill-recommendation.md`, `skillspector-scan` v1, `skills-section` v1, `design-skills-section` v1. The Role finds and vets by reading and has no Bash. You scan every pick (`vet`), and only you add skills, and only after both forms below (agentsec.M-SEC4).

## 1. Before the dispatch
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillspector.mjs" detect --json`. `installed: false` → offer the SkillSpector install form from `skills/skillspector/SKILL.md` (always asked, whatever `gates.installs` says). Skip → no dispatch; the Gate summary says "no skill picks without the scanner".

## 2. Dispatch
Use the `aico:pipeline` §2 prompt, so the block carries `Name:`, `Language:` and `Context cap:` like every dispatch. Put the Area in the Goal block as its own line: `Area: stack | product-type | company-type | design` (one value). Read the Area-specific inputs from the Contract.

## 3. After the Handoff
1. **Vet:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-picks.mjs" vet .company/work/<slug>/<NN>-skill-researcher.md --json` (the path from the dispatch, never typed from Role text). Progress goes to stderr. A failing lint line is dropped and named by number, never repaired. Commands use tokens from the `vet` output only. `refused: skillspector missing` → the install form of section 1; `refused: git missing` → say git is needed. Nothing is approvable then.
2. **Approve form** (never auto), whatever the Gate settings: each approvable pick with your scan in words (`no-llm scan of commit abc1234, 0 critical, 0 high, 1 medium`; `static-fallback` as "static fallback, not an LLM scan"; `refs_not_bundled > 0` as "<n> references to files outside the skill, not inspected"; a plugin skill as "plugin skill, not scanned; installed only by you with /plugin"), then the not-approvable picks with their `reject_code` and the Role's rejected list with codes. No pick approvable → no form; the Gate summary lists each pick with its code. Options: Approve the set (Recommended) / Change / Skip. Skip writes nothing.
3. **Record** the approved picks' `record` lines: area `design` into `## Design skills`; `stack`, `product-type` and `company-type` into `## Skills`. The Role's `approved: pending` is never copied.
4. **Install / Skip form**, only after approval: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-skills.mjs" design --project .company/project.md --dry-run` (group `skills` for the other areas) and show the printed commands, which install the recorded commit, and the telemetry line. Say that `npx skills update` would move a skill off the scanned commit. Options: Install (Recommended) / Skip. Only a user-level `gates.installs: auto` skips this form and answers it Install; it never answers the approve form or the stop form. An `ERROR … line <n>` means install nothing and name line `<n>`. Install artifacts (`.agents/`, `.claude/skills/`, `skills-lock.json`) are never committed; the summary names them with the removal command.
5. Nothing installs unless the approve form and the Install / Skip form (or `gates.installs: auto`) say yes (AC5).

## 4. Post-install scan
After each skill installs, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillspector.mjs" scan --scope project --skill <name> --json` with `<name>` from the `vet` output. Scan mode comes from settings (`skillspector.mode`), never from the Role. `pass` or non-blocking `findings` → report and go on. `findings` with `blocking: true`, or `error`, **stops the run** with a CEO form (never auto, whatever the Gate settings): the skill, the verdict with its Why and Next, and the removal command `npx -y skills@1.7.4 remove <name> -a claude-code`, run in the product root. Options: Stop the run (Recommended) / Keep it and go on. You run no removal command (AC14); Keep is recorded in the Gate summary with the verdict.

## 5. Never
Pass Role text into a command, a path or a `source`; write a line the lint dropped; rank by downloads or stars; run any removal command; answer the approve form or the stop form automatically.
