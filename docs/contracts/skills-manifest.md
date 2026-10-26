# Contract: skills-manifest v2.1

Provider: `deps/skills.json` (plugin groups, user scope) `.company/project.md` `## Design skills` (group `design`, project scope, see `design-skills-section` v1) and `## Skills` (group `skills`, project scope, see `skills-section` v1). Consumer: `scripts/install-skills.mjs`, called by `aico:setup`, `aico:research`, `aico:feature`.
v1 = 0.8.1 shape. v2 is additive: every v1 manifest is valid v2. v2.1 is additive with `skills-section` v1: group `skills` and `parseSkillsSection`; every v2 manifest is valid v2.1.

## Group entries
- `{ "name", "source" }` → `npx -y skills@1.7.4 add <source> -s <name> -g -a claude-code -y` (user scope; the CLI pin is one constant, bumped in a change of its own, agentsec.S1).
- `{ "name", "install" }` → the literal install command (unchanged).
- `{ "include": "<group>" }` → new: expands to that group's entries. `core` contains `{ "include": "research" }`, so `/aico:setup` (default `core`) also installs `research`.
- Optional on any entry: `"license"` (SPDX), `"vetted"` (YYYY-MM-DD), `"commit"` (the SHA read when vetting, agentsec.S2). `license` and `vetted` are **required** on every entry of the `research` group (checked by `scripts/check.mjs`).
- Commands from `deps/skills.json` are repo-owned. `name` and `source` of every entry still match the agentsec.M-SEC7 patterns (`name` may end in `*`); `check.mjs` reports any that do not.

## `research` group (AC7, Spike S1)
- Exactly one entry: `{ "name": "find-skills", "source": "vercel-labs/skills", "license": "MIT", "vetted": "2026-10-22" }`. It is also in `core`; the commands are deduplicated.
- S1 approved no other skill: every keyless candidate either ran code, needed an account or browser login, or added nothing over the baseline.
- Baseline, not in the manifest: the WebSearch/WebFetch tools, plus keyless public endpoints named in `aico:sourcing` (fetched with WebFetch, no skill needed).
- Plugin skills are never manifest entries: `mattpocock-skills:research` arrives with the plugin dependency; `anthropic-skills:deep-research` is used when the session lists it and is never required.
- **find-skills is guidance only.** Roles that load it follow the Role and `aico:sourcing` rules where they conflict: never run `npx skills find` or `npx skills add` (its install step with `-g -y` is skipped), never rank or trust by install count, and search through WebSearch, WebFetch of `skills.sh/<owner>/<repo>/<skill>` pages and the keyless GitHub repository search. skills.sh `/api/` and `/search` are never fetched (robots.txt disallows them; proj.M10).

## CLI additions to `install-skills.mjs`
| Flag | Effect |
|---|---|
| `--dry-run` | unchanged: `[dry-run] <cmd>` per missing skill, or `All skills already installed.`; group `design` lines read `[dry-run] (in <product root>) <cmd>` |
| `--missing` | prints `missing <name>` per missing skill (no commands), exit 0; nothing missing → no output |
| `--project <path>` | adds group `design` parsed from that file's `## Design skills` and group `skills` parsed from its `## Skills`. `<path>` must end in `.company/project.md`; product root = its grandparent. Groups `design` and `skills` without `--project` are `unknown group design` / `unknown group skills` |

- Groups `design` and `skills` repo entries → `npx -y skills@1.7.4 add <source> -s <name> -a claude-code -y` (**no `-g`**), run with `cwd` = product root. Command entries → the manifest's `install` string. Plugin entries and names containing `:` are skipped.
- Every command is one string built only from allow-listed tokens and run through `execSync(cmd, { cwd, stdio })`; never an `args` array with `shell: true` (node.M-SEC5, DEP0190).
- Installed detection adds `<product root>/.claude/skills` and `<product root>/.agents/skills` when `--project` is given.
- Exports for tests: `plan`, `runAll`, `expand(manifest, groups)`, `missing(manifest, groups, installed)`, `parseDesignSkills(markdown, manifest)` and `parseSkillsSection(markdown, manifest)` (the manifest is needed for the byte-identical command check).

## Presence check (AC8), run by the Playbook at run start
1. `node install-skills.mjs <groups> [--project .company/project.md] --dry-run`. No command printed → present.
2. Plugin skills the run wants (`mattpocock-skills:research`, `anthropic-skills:deep-research`, plugin design skills) → checked against the session's skill list; missing required plugin skill → its `/plugin install <plugin>` line is shown with the commands; optional ones are not shown.
3. Anything missing → show the printed commands, one line `The skills CLI sends anonymous telemetry (skill name, timestamp) to skills.sh.`, and ask **one** form: Install (Recommended) / Skip. Install → same command without `--dry-run`, then tell the CEO to `/reload-plugins`. Skip → continue on the baseline, record `degraded: missing <name>, <name>` in the report/Handoff frontmatter. Never install without the form. No Role or Playbook runs `npx skills find`.

## Error cases
- `include` of an unknown group or an include cycle → throws `unknown group <g>` / `include cycle <a> -> <b>`, exit 1, nothing installed.
- `--project` path not ending in `.company/project.md` → `ERROR --project must point to <root>/.company/project.md`, exit 1.
- `--project` file missing or no `## Design skills` / `## Skills` section → that group is empty (not an error).
- A `## Design skills` line that fails `design-skills-section` v1 → `ERROR design skill line <n>: <field> <reason>`, exit 1, nothing installed in any group.
- A `## Skills` line that fails `skills-section` v1 → `ERROR skills line <n>: <field> <reason>`, exit 1, nothing installed in any group. `plugin <p>` sources are not allowed in group `skills`; at most 5 lines per area and 15 in all.
