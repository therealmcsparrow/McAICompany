# Contract: design-skills-section v1.2

The project-level skill list. Lives in `.company/project.md` under `## Design skills` (template: `skills/lead/references/project-template.md`). Not in `.company/standards.md`.
Writer: the Lead, after the CEO approves a set the `design-researcher` recommended, or a `design` set the `skill-researcher` recommended and `skill-picks.mjs vet` scanned (`skill-recommendation` v1.3). Readers: `install-skills.mjs --project` (`skills-manifest` v3.0), `aico:pipeline` (the `Design skills:` dispatch line, `dispatch-prompt` v2), `aico:feature` (freshness), `design-researcher` and `skill-researcher` (judge the current set).
This section is the project-scope skill inventory (agentsec.M-SEC6). Its text is untrusted at parse time: an LLM wrote it from web research, so nothing in it reaches a shell unless it passes the allow-list below (agentsec.M-SEC7, node.M-SEC1, node.M-SEC5, proj.M1–M4).
v1.1 (task skill-researcher-scan, Fix round 1, additive, minor bump per `docs/adr/0007-contract-minor-versions.md`): an optional `commit` field pins a repo install to the commit that was scanned. Every v1 line is a valid v1.1 line and installs exactly as before.
v1.2 (task skill-audit-bugs, minor, per `docs/adr/0007-contract-minor-versions.md`): a `command` source is never run, at any scope: the installer prints it as `manual <cmd>` with a warning. The old unpinned `impeccable` line (`` `npx -y impeccable skills install` ``) stays accepted as a known old form: it resolves to the pinned manifest command and is printed as `manual`, so a product with that line keeps working and edits nothing.

## Format
```markdown
## Design skills
<!-- approved by the CEO from a design-researcher run; one skill per line -->
- name: impeccable; source: `npx -y impeccable@4.8.0 skills install`; license: Apache-2.0; vetted: 2026-10-22; why: <one line>; approved: 2026-10-22
- name: hallmark; source: nutlope/hallmark; license: MIT; vetted: 2026-10-22; why: <one line>; approved: 2026-10-22
- name: aico:ui-design; source: plugin aico; license: -; vetted: -; why: <one line>; approved: 2026-10-22
- name: <name>; source: <owner/repo>; license: MIT; vetted: 2026-10-26; commit: <40 hex>; why: <one line>; approved: 2026-10-26
```
- Keys in this order, separated by `; `: `name`, `source`, `license`, `vetted`, optional `commit`, `why`, `approved`. The whole line matches `^- name: ([^;]+); source: ([^;]+); license: ([^;]+); vetted: ([^;]+); (?:commit: ([^;]+); )?why: ([^;]+); approved: ([^;]+)$` (anchored, no nested quantifiers), then each field is checked below.
- Empty section: the single line `- (none yet; the design-researcher proposes them)`.
- At most 5 entry lines (AC20). Blank lines and `<!-- … -->` lines are skipped. The section ends at the next `## ` heading or end of file.

## Field allow-list (every check is a full-match, anchored pattern)
| Field | Allowed |
|---|---|
| `source` = repo | `^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$`, repo part not `.` or `..`. Installed by the skills CLI in project scope. |
| `source` = command | `` `<cmd>` `` where `<cmd>` is **byte-identical** to the `install` value of a `deps/skills.json` entry (any group) **with the same `name`**, or the known old form of `impeccable` (`npx -y impeccable skills install`, unpinned), which resolves to that entry's pinned command. Printed as `manual <cmd>` and never run; never a command composed from the line. |
| `source` = plugin | `plugin <p>`, `<p>` matches `^[a-z0-9][a-z0-9-]{0,63}$`. Never installed by the script. |
| `name` (repo or command source) | `^[a-z0-9][a-z0-9-]{0,63}$` (no `*`, no `:`) |
| `name` (plugin source) | `<p>:<skill>`, both parts `^[a-z0-9][a-z0-9-]{0,63}$`, `<p>` equal to the source's plugin |
| `license` | SPDX id or `LicenseRef-<x>`, `^[A-Za-z0-9.+-]{1,64}$`, not `NONE` or `NOASSERTION`; `-` only for plugin source |
| `vetted`, `approved` | `^\d{4}-\d{2}-\d{2}$`, a real calendar date, not after today; `vetted` may be `-` only for plugin source |
| `commit` (v1.1, optional) | repo source only: `^[0-9a-f]{40}$`. Absent → unpinned install, as in v1. Present on a command or plugin source, or not 40 hex → `commit invalid`. |
| `why` | 1–200 characters, no `;`, no backtick, no `<` or `>` |

Bounds (proj.M3): project.md read ≤ 256 KiB, each section line ≤ 500 characters, checked before any pattern runs.

## Freshness
The set is **stale** when the section is empty or the newest `approved:` date is more than 180 days before today. `aico:feature` runs the `design-researcher` Step only when the product has UI (`product_type` web, desktop or game, or the brief has UI work) and the set is stale. Re-approving a skill rewrites its `approved` date; re-vetting rewrites `vetted`.

## Installs (project scope, only after the CEO's pick)
- Lines are written only after the CEO approves the set in a form; installs run only after a second Install / Skip form shows the exact commands (agentsec.M-SEC4). No Role installs.
- Repo sources install with project scope (no `-g`), cwd = product root. With `commit` the source is `<owner>/<repo>#<commit>` (`skills-manifest` v3.0), so the installed files are the scanned ones. This creates `.agents/skills/<name>/`, `.claude/skills/<name>` and `skills-lock.json` in the product repo. No Playbook commits these; the summary names them and the rollback (`npx -y skills@<pin> remove <name> -a claude-code`, run in the product root).
- Command sources are never run, at any scope: the installer prints `manual <cmd>` and a `WARNING:` line to run it by hand, only from the home folder (first `cd` to the home path the WARNING line prints, then `<cmd>` as a separate step) and never from a product folder, and exits 0 (`skills-manifest` v3.0). Run in a product folder, a package manager can pick up the repo's own copy of the package (`node_modules/impeccable`), and the pin does not stop that. Its scope is whatever that installer does (impeccable: not verified, said so in the form). The form says so before the CEO approves.

## Error cases
- A line that fails any check → `install-skills.mjs` prints `ERROR design skill line <n>: <field> <reason>` (`<n>` = line number in project.md; the offending text is never echoed), exit 1, **nothing installed in any group**. The pipeline sends `Design skills: none` and names the bad line number in the Gate summary.
- More than 5 entry lines, an over-long line or an over-size file → same exit, reason `too many entries` / `line too long` / `file too large`.
- A listed skill that is not installed → the Role names it under `## Next` (`dispatch-prompt` v2); the Lead offers the AC8 Install / Skip form at the next run start.
