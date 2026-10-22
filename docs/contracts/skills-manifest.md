# Contract: skills-manifest v2

Provider: `deps/skills.json` (plugin groups) and `.company/project.md` `## Design skills` (project group, see `design-skills-section` v1). Consumer: `scripts/install-skills.mjs`, called by `aico:setup`, `aico:research`, `aico:feature`.
v1 = 0.8.1 shape. v2 is additive: every v1 manifest is valid v2.

## Group entries
- `{ "name", "source" }` → `npx -y skills add <source> -s <name> -g -a claude-code -y` (unchanged).
- `{ "name", "install" }` → the literal install command (unchanged).
- `{ "include": "<group>" }` → new: expands to that group's entries. `core` contains `{ "include": "research" }`, so `/aico:setup` (default `core`) also installs `research`.
- Optional on any entry: `"license"` (SPDX), `"vetted"` (YYYY-MM-DD). **Required** on every entry of the `research` group (checked by `scripts/check.mjs`).

## `research` group (AC7)
- Baseline, not in the manifest: the WebSearch/WebFetch tools.
- `find-skills` from `vercel-labs/skills` (already in `core`; deduplicated). The design-researcher depends on it.
- Plus the entries Spike S1 approves (source, license, maintained, no API key). None approved → the group holds `find-skills` only.
- Plugin skills are never manifest entries: `mattpocock-skills:research` arrives with the plugin dependency; `anthropic-skills:deep-research` is used when the session lists it and is never required.

## CLI additions to `install-skills.mjs`
| Flag | Effect |
|---|---|
| `--dry-run` | unchanged: `[dry-run] <cmd>` per missing skill, or `All skills already installed.` |
| `--missing` | prints `missing <name>` per missing skill (no commands), exit 0; nothing missing → no output |
| `--project <path>` | adds group `design` parsed from that project.md's `## Design skills`; group `design` without `--project` is `unknown group design` |

Entries whose name contains `:` (plugin skills, e.g. `aico:ui-design`) are skipped by the installer. Exports for tests: `plan`, `runAll`, `expand(manifest, groups)`, `missing(manifest, groups, installed)`, `parseDesignSkills(markdown)`.

## Presence check (AC8), run by the Playbook at run start
1. `node install-skills.mjs <groups> [--project .company/project.md] --dry-run`. No command printed → present.
2. Plugin skills the run wants (`mattpocock-skills:research`, `anthropic-skills:deep-research`, plugin design skills) → checked against the session's skill list; missing required plugin skill → its `/plugin install <plugin>` line is shown with the commands; optional ones are not shown.
3. Anything missing → show the printed commands and ask **one** form: Install (Recommended) / Skip. Install → same command without `--dry-run`, then tell the CEO to `/reload-plugins`. Skip → continue on the baseline, record `degraded: missing <name>, <name>` in the report/Handoff frontmatter. Never install without the form.

## Error cases
- `include` of an unknown group or an include cycle → throws `unknown group <g>` / `include cycle <a> -> <b>`, exit 1, nothing installed.
- `--project` path missing or no `## Design skills` section → group `design` is empty (not an error).
- A `## Design skills` line that does not parse → `ERROR design skill line <n>: <text>`, exit 1, nothing installed.
