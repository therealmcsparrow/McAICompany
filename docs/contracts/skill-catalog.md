# Contract: skill-catalog v1

Provider: the module scripts/skill-catalog.mjs (read, validate, status; imports no `node:child_process`) and the baseline file deps/3rdpartyskills.json. Consumers: `install-skills.mjs`, `settings.mjs`, `settings-server.mjs`, `skill-picks.mjs`, `sbom.mjs`, `check.mjs`, the migration, add and record commands in scripts/role-skills.mjs. Rationale: ADR 0062.

## Layers
| Layer | Path | Writer | Holds |
|---|---|---|---|
| Baseline | deps/3rdpartyskills.json, located from `import.meta.url`, never from `CLAUDE_PLUGIN_ROOT` or the working folder | a plugin release | `categories`, `groups`, `entries`; read-only; repo-owned, so a command here is trusted as text only and is still never run |
| User | `<user home>/.mcsparrow/3rdpartyskills.json` | `/aico:add-skill`, migration, `role-skills record`, the installer's `hash` and `vetted` write | `entries` only |

- **User home** = `os.userInfo().homedir`, the operating system's answer. `os.homedir()` is not used: it reads `HOME` and `USERPROFILE`, which a repo's `.claude/settings.json` `env` can set. A throw → no user layer, one warning.
- **`MCSPARROW_HOME` set** and not resolving to `<user home>/.mcsparrow` → the user catalog and user-level selections are not read or written, one warning `role skills: MCSPARROW_HOME is set, the user catalog is not read`. The read path never moves.
- **Settings folder moved** by any env (`HOME` and `USERPROFILE` too, since `settings.mjs` follows `os.homedir()`): user-level selections are not counted, `--selected` user-scope installs from `<user home>` and takes no `gates.installs: auto` answer. Other settings and `/aico:setup` are unchanged.
- Nothing is read from a product folder: no catalog file, no project setting and no env value supplies an entry, a command or a path. A project selects by name only (`aico-settings`). One exception, migration: an old `.company/project.md` section line becomes a user entry only after a CEO form that shows its validated name, source, commit, license, `vetted` and `approved` per line. A value that fails its pattern is never shown and its line stays; a line's license must also pass the old section's pattern (`design-skills-section`). Migration keeps the old `approved` date: it only decides whether a research Step runs, never trust or install.
- Tests pass `{ home }` to the exported functions. No env value is a seam.

## Schema (`"schema": 1`; unknown keys refused)
Baseline: `{ "schema": 1, "categories": {…}, "groups": {…}, "entries": […] }`. User: `{ "schema": 1, "entries": […] }`.
- `categories`: exactly the closed list `engineering`, `design`, `security`, `quality`, `product`, `research`, `content`, each to its Role ids: engineering: architect, senior-engineer, backend-engineer, frontend-engineer, desktop-engineer, game-engineer, ai-data-engineer, devops. design: ui-ux-designer, brand-artist, game-artist, motion-artist, prompt-artist, frontend-engineer, desktop-engineer, game-engineer. security: security, pentester, vuln-scanner. quality: qa, code-reviewer, fresh-reviewer, hands-on-tester, persona-tester, accessibility-tester. product: product-manager, account-manager, ux-researcher, legal, reprompter. research: market-researcher, tech-researcher, design-researcher, skill-researcher. content: writer, editor, marketer, localizer, support. `check.mjs` fails when an `agents/*.md` Role is in no category or a listed Role has no agent.
- `groups`: group name → ordered list of skill names or `{ "include": "<group>" }`. Only the baseline has groups; expansion order and de-duplication give the same `/aico:setup` commands as the old manifest.

| Entry field | Rule |
|---|---|
| `skillname` | `^[a-z0-9][a-z0-9-]{0,63}$`. Baseline may end in `*` (wildcard: shown, never selectable, reason `a wildcard names no one skill`). Plugin kind: `<p>:<skill>`, both parts that pattern |
| `skillcategory` | one closed-list key |
| source, exactly one of | `skillrepo` `^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$`, repo part not `.` or `..`; `skillinstaller`; `skillplugin` `^[a-z0-9][a-z0-9-]{0,63}$`, equal to `<p>` |
| `skillinstaller` | at most 200 characters, tokens `^[A-Za-z0-9@._/:=+-]+$` joined by single spaces (so no shell operator or control character), and one token exactly `[@scope/]<pkg>@<x.y.z>` |
| `skillcommit` | `^[0-9a-f]{40}$`. Required on a user `skillrepo` entry; optional on a baseline one; refused on the other kinds |
| `license` | text of 1 to 64 characters after trimming, stored trimmed, with no control, format, separator or invisible character (`Cc`, `Cf`, `Zl`, `Zp`, every `Default_Ignorable_Code_Point`, U+180E, U+2065, tag characters U+E0000-U+E007F), so whitespace only counts as empty; any other text is accepted, with no check against a list or the repo. Required on every user entry, as the CEO states it; nothing checks it. Optional on a baseline entry, and never inferred or filled in |
| `vetted` | real date not after today. Optional. On a user entry: the installer writes it with `hash` after a clean scan and clears both after a failed or errored scan; migration moves the old value; a researcher record writes none. A command entry is never scanned and shows as not vetted, even if the file holds a date |
| `hash` | `^[0-9a-f]{64}$`, written only by the installer after a scan |

Baseline carries `license` as a sourced value only (the run's Step 17 table, read 2026-11-06), and `vetted` on the `research` group's entries, as the old manifest did. With no license value, under a CEO exception (agentsec.M-SEC6, `.company/standards.md`): `vercel-react-best-practices`, `vercel-composition-patterns`, `two-factor-authentication-best-practices`. `aico:ui-design`, aico's own plugin, is a baseline entry with no license, in no group, so it adds no `/aico:setup` command. A license adds nothing to and changes nothing in a command.

Bounds: user file a regular file (`lstat`, a link is refused), at most 256 KiB, at most 200 entries. A bad file → empty user layer, `ERROR user catalog: <file too large|link|bad JSON>`. A bad entry → `ERROR user catalog entry <n>: <field> <reason>`, its text never echoed; it cannot be selected and nothing from it installs. Baseline entries still work. A bad baseline → `check.mjs` fails; at run time `ERROR baseline catalog`, exit 1.

**Merge:** on a name clash the baseline wins and the clash is reported, except a user entry with the same source and a `skillcommit`, which pins that baseline entry for Role skill installs only. `/aico:setup` groups read the baseline alone, so their commands never change with the user file. A pin holds its own license and vetted date, from the old line or the CEO's form, never the baseline's, and `skillStatus` shows those.

**One commit per name** in the user file, for `addUserEntry`, migration and `role-skills record`: an equal entry writes nothing; another commit is refused unless a CEO form chose Move (`{ moveCommit: true }`), which sets the commit and license and clears `hash` and `vetted`, keeps the category and every selection, and other products then read `folder not recognized` until reinstalled; another source is refused.

## Exports
`userCatalogPath({ home })`, `readBaseline()`, `readCatalog({ home })` → `{ entries, errors, clashes }`, `validateEntry(entry, layer)`, `expandGroups(baseline, groups)`, `eligibleRoles(entry, categories)`, `selectable(entry)`, `approvable(scan, hash)`, `boundedFolderHash(dir)`, `skillStatus(entry, { home, productRoot, scope })` → `{ status, place, license, vetted }`, `addUserEntry(entry, { home, moveCommit })`, `setBoundHash(name, hash, vetted, { home })` (writes both or neither), `clearBound(name, { home })` (clears both). Writes are atomic (temp file, then rename) and keep every other entry's values.

## Selected install (`install-skills --selected`)
| Kind | What happens |
|---|---|
| Repo with a commit (user entry or user pin) | No license → `no license`, nothing installed. Scan at the commit; failed, errored or not approvable → `clearBound`, nothing installed, the skill reported `missing`. Folder already equal to the scan hash → bind, no install. Else install `#<commit>` at the selection's scope: a project-level list with no `-g`, working folder `<product root>`; a user-level list with `-g`, working folder `<user home>`; every child with `HOME` and `USERPROFILE` set to `<user home>` and `CLAUDE_CONFIG_DIR` removed in any letter case; compare `boundedFolderHash` with the scan hash; equal → `setBoundHash` with today; different → `hash differs`, nothing stored, the remove command printed, exit 1; the folder stays until the CEO removes it, so the Lead shows the stop form (never auto) and the skill is on no `Role skills:` line |
| Unpinned baseline repo | Never scanned or installed here; `needs a pin` naming `/aico:add-skill`. `installed (name only)` counts as present |
| Installer | `manual` line and warning only |
| Plugin | Skipped, one `/plugin` line |
| Wildcard | Cannot be selected, so never reached |

## Status (`skillStatus`; only `lstat`, `readdir` and file reads)
No child process, no parsing of `skillinstaller`, no network, no link followed. Place checked: `<product root>` first, then `<user home>`, under `.claude/skills/<name>` and `.agents/skills/<name>`. With `scope` `user` only `<user home>` is checked: a folder or link under `<product root>` does not count, whatever its hash, so with nothing in `<user home>` a repo entry with a commit reads `missing` and an installer or unpinned baseline repo entry reads `not found`. `scope` is `user` when any Role selecting the skill has a user-level list, else `project`. Plugin entries are not read here.
- Repo entry with commit: `installed` = a real folder (`lstat`; the CLI's `.claude/skills/<name>` is usually a link, so `.agents/skills/<name>` is the one hashed) whose `boundedFolderHash` equals `hash`; `folder not recognized` = present, but the hash differs, none is bound, it is a link with no real folder, or it is over the bound; `missing` = nothing there. `--selected` treats `folder not recognized` like `missing`.
- Installer or unpinned baseline repo entry: `installed (name only)` = a folder or link of that name, version not checked; `not found` = none, which is not proof, since an installer may write elsewhere.
- Plugin entry: `checked at run start`.
- Every skill also shows two texts, as plain text and never as markup, on the settings page, in `--status` and in the run-start form. License: `<license>, as stated, not checked`, or `no license on record` for a baseline entry with none, which never blocks selecting, installing or printing it. Vetted: `vetted <YYYY-MM-DD>` when a date is recorded, else `not vetted`. A date on a user entry with no `hash` reads `vetted <YYYY-MM-DD>, from the old list, not scanned here`; among user entries only migration leaves that state. An installer entry always reads `not vetted`, so `skillStatus` returns `vetted` null for it even if the file holds a date.
- `boundedFolderHash`: the same files, order and bytes as `skillFolderHash` of `skillspector-scan` (a test holds them equal); refuses a link at the top, at most 2000 files and 64 MiB, over → null.

## Error cases
A stored selection outside the catalog or the Role's categories: `aico-settings` `ignored` by field path, never its value, and never dispatched. Any stop before Save in `/aico:add-skill` writes nothing. `role-skills record` on a new entry with no license stated writes nothing for it and prints `no license stated: <name>`. A user catalog that cannot be written → `ERROR user catalog: cannot write`, nothing changed. Free text reaches `role-skills add` and `role-skills record` only as one line of JSON on stdin, never on a command line. A selected skill reaches a `Role skills:` line only with status `installed` or `installed (name only)`, or as a plugin entry in the session's skill list at run start; otherwise it is left off and the run records `degraded: missing <name>`.
