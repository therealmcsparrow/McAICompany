# Contract: design-skills-section v2.0

The old project-level skill list. Lives in `.company/project.md` under `## Design skills`. Not in `.company/standards.md`.
Writer: none since v2.0. Reader: the migration in scripts/role-skills.mjs (`skill-catalog` v1), with a CEO form showing each line's validated name, source, commit, license and dates before any entry is written.
This section was the project-scope skill inventory; that inventory now lives in `skill-catalog` v1 (agentsec.M-SEC6). Its text is untrusted at parse time: an LLM wrote it from web research, so nothing in it reaches a shell, and no field of a line is shown or stored unless it passes the allow-list below (agentsec.M-SEC7, node.M-SEC1, node.M-SEC5, proj.M1–M4).
v1.1 (task skill-researcher-scan, Fix round 1, additive, minor bump per `docs/adr/0007-contract-minor-versions.md`): an optional `commit` field pins a repo install to the commit that was scanned. Every v1 line is a valid v1.1 line and installs exactly as before.
v1.2 (task skill-audit-bugs, minor, per `docs/adr/0007-contract-minor-versions.md`): a `command` source is never run, at any scope: the installer prints it as `manual <cmd>` with a warning. The old unpinned `impeccable` line (`` `npx -y impeccable skills install` ``) stays accepted as a known old form: it resolves to the pinned manifest command and is printed as `manual`, so a product with that line keeps working and edits nothing.
v2.0 (task role-skills-file, major, per `docs/adr/0007-contract-minor-versions.md`; rationale ADR 0062): the section is no longer read at run time. No install, dispatch or researcher reads it, and `Design skills:` is gone (`dispatch-prompt` v5.0). Only the migration reads it, and the format below stays as that migration's input. A migrated line becomes a user catalog entry and Role selections, and keeps its `approved` date.

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
| `source` = repo | `^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$`, repo part not `.` or `..`. |
| `source` = command | `` `<cmd>` `` where `<cmd>` is **byte-identical** to the `skillinstaller` value of a baseline entry (deps/3rdpartyskills.json, `skill-catalog` v1) **with the same `name`**, or the known old form of `impeccable` (`npx -y impeccable skills install`, unpinned), which resolves to that entry's pinned command. A user catalog entry is never the compare. Never run; never a command composed from the line. |
| `source` = plugin | `plugin <p>`, `<p>` matches `^[a-z0-9][a-z0-9-]{0,63}$`. Never installed by the script. |
| `name` (repo or command source) | `^[a-z0-9][a-z0-9-]{0,63}$` (no `*`, no `:`) |
| `name` (plugin source) | `<p>:<skill>`, both parts `^[a-z0-9][a-z0-9-]{0,63}$`, `<p>` equal to the source's plugin |
| `license` | SPDX id or `LicenseRef-<x>`, `^[A-Za-z0-9.+-]{1,64}$`, not `NONE` or `NOASSERTION`; `-` only for plugin source |
| `vetted`, `approved` | `^\d{4}-\d{2}-\d{2}$`, a real calendar date, not after today; `vetted` may be `-` only for plugin source |
| `commit` (v1.1, optional) | repo source only: `^[0-9a-f]{40}$`. Present on a command or plugin source, or not 40 hex → `commit invalid`. |
| `why` | 1–200 characters, no `;`, no backtick, no `<` or `>` |

Bounds (proj.M3): project.md read ≤ 256 KiB, each section line ≤ 500 characters, checked before any pattern runs.

## Freshness
Moved to `aico-settings` v1.12: the `approved` date on `roles.<role>.skills`. It only decides whether a research step runs, never trust or install (agentsec.M-SEC4, proj.M-SEC8).

## Installs
None from this section since v2.0. A migrated line installs as any Role selection, through `install-skills --selected` and its Install form (`skill-catalog` v1).

## Error cases
- A line that fails any check is never shown by the migration and stays in the section; the reason names `<n>` (line number in project.md) and the field, and the offending text is never echoed.
- More than 5 entry lines, an over-long line or an over-size file: same, reason `too many entries` / `line too long` / `file too large`.
