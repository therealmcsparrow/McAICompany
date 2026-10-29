# Skill picks (the Lead's side of `skill-recommendation` v1)

Load when the route has a `skill-researcher` Step. Contracts: `docs/contracts/skill-recommendation.md`, `skillspector-scan` v1, `skills-section` v1, `design-skills-section` v1. The Role finds and vets by reading and has no Bash. You scan every pick (`vet`), and only you add skills, and only after both forms below (agentsec.M-SEC4).

## 1. Before the dispatch
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillspector.mjs" detect --json`. `installed: false` → offer the SkillSpector install form from `skills/skillspector/SKILL.md` (always asked, whatever `gates.installs` says). Skip → no dispatch; the Gate summary says "no skill picks without the scanner".

## 2. Dispatch
Use the `aico:pipeline` §2 prompt, so the block carries `Language:` and `Context cap:` like every dispatch, and no name. Put the Area in the Goal block as its own line: `Area: stack | product-type | company-type | design` (one value). Read the Area-specific inputs from the Contract.

## 3. After the Handoff
1. **Vet:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-picks.mjs" vet .company/work/<slug>/<NN>-skill-researcher.md --json` (the path from the dispatch, never typed from Role text). Progress goes to stderr. A failing lint line is dropped and named by number, never repaired. Commands use tokens from the `vet` output only. `refused: skillspector missing` → the install form of section 1; `refused: git missing` → say git is needed. Nothing is approvable then.
2. **Approve form** (never auto), whatever the Gate settings: each approvable pick with your scan in words (`no-llm scan of commit abc1234, 0 critical, 0 high, 1 medium`; `static-fallback` as "static fallback, not an LLM scan"; `refs_not_bundled > 0` as "<n> references to files outside the skill, not inspected"; a plugin skill as "plugin skill, not scanned; installed only by you with /plugin"), then the not-approvable picks with their `reject_code` (`commit-not-in-repo` is "that commit is on no branch or tag of the named repo"; a command pick is "command source: it cannot be pinned, so it cannot be approved") and the Role's rejected list with codes. Approvable means `picks[].approvable` is true; it needs a `picks[].hash`. No pick approvable → no form; the Gate summary lists each pick with its code. Options: Approve the set (Recommended) / Change / Skip. Skip writes nothing.
3. **Record** the approved picks' `picks[].record` lines: area `design` into `## Design skills`; `stack`, `product-type` and `company-type` into `## Skills`. The Role's `approved: pending` is never copied.
4. **Install / Skip form**, only after approval: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-skills.mjs" design --project .company/project.md --dry-run` (group `skills` for the other areas) and show the printed commands, which install the recorded commit, and the telemetry line. Say that `npx skills update` would move a skill off the scanned commit. Options: Install (Recommended) / Skip. Only a user-level `gates.installs: auto` skips this form and answers it Install; it never answers the approve form or the stop form. An `ERROR … line <n>` means install nothing and name line `<n>`. Install artifacts (`.agents/`, `.claude/skills/`, `skills-lock.json`) are never committed; the summary names them with the removal command.
5. Nothing installs unless the approve form and the Install / Skip form (or `gates.installs: auto`) say yes (AC5).

## 4. Post-install scan and checks
Scan mode comes from settings (`skillspector.mode`), never from the Role. Run these for each approved repo pick, after the install commands ran, whatever their exit code.
1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/skill-picks.mjs" check-install --name <name> --hash <hash> --json`, with `<name>` (`picks[].name`) and `<hash>` (`picks[].hash`) from the `vet` output only.
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/skillspector.mjs" scan --scope project --skill <name> --json`.

Go on only when `check-install` printed `bound: true` **and** the scan printed one JSON document whose `results` hold at least one entry, each `pass` or `findings` with `blocking: false`. Report the verdicts and go on.

Every other outcome **stops the run** (fail closed): `bound: false`, any `refused: …` line (including `refused: skill not found`, which means the CLI installed another folder or nothing), a non-zero exit, output that is not one JSON document, an empty `results`, `findings` with `blocking: true`, or `error`. The stop is a CEO form (never auto, whatever the Gate settings) that names the skill, what failed, and the removal command `npx -y skills@1.7.4 remove <name> -a claude-code`, run in the product root. What failed reads:
- `bound: false`: "the installed files are not the files aico scanned before you approved".
- a scan verdict: the verdict with its Why and Next.
- anything else: the refusal text, or "the check gave no usable result".

Options: Stop the run (Recommended) / Keep it and go on. You run no removal command (AC14); Keep is recorded in the Gate summary with what failed.

## 5. Never
Pass Role text into a command, a path or a `source`; write a line the lint dropped; rank by downloads or stars; run any removal command; answer the approve form or the stop form automatically.
