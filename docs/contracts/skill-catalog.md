# Contract: skill-catalog v1

Provider: the module scripts/skill-catalog.mjs (read, validate, status; imports no `node:child_process`) and the baseline file deps/3rdpartyskills.json. Consumers: `install-skills.mjs`, `settings.mjs`, `settings-server.mjs`, `skill-picks.mjs`, `sbom.mjs`, `check.mjs`, the migration and add commands in scripts/role-skills.mjs. Rationale: ADR 0062.

## Layers
| Layer | Path | Writer | Holds |
|---|---|---|---|
| Baseline | deps/3rdpartyskills.json, located from `import.meta.url`, never from `CLAUDE_PLUGIN_ROOT` or the working folder | a plugin release | `categories`, `groups`, `entries`; read-only; repo-owned, so a command here is trusted as text only and is still never run |
| User | `<user home>/.mcsparrow/3rdpartyskills.json` | `/aico:add-skill`, migration, the Lead's researcher record, the installer's `hash` write | `entries` only |

- **User home** = `os.userInfo().homedir`, the operating system's answer. `os.homedir()` is not used: it reads `HOME` and `USERPROFILE`, which a repo's `.claude/settings.json` `env` can set. A throw → no user layer, one warning.
- **`MCSPARROW_HOME` set** and not resolving to `<user home>/.mcsparrow` → the user catalog and user-level selections are not read or written, one warning `role skills: MCSPARROW_HOME is set, the user catalog is not read`. The read path never moves.
- Nothing is read from a product folder: no catalog file, no project setting and no env value supplies an entry, a command or a path. A project selects by name only (`aico-settings`).
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
| `license`, `vetted`, `hash` | optional: as in `design-skills-section` (license id, real date not after today); `hash` `^[0-9a-f]{64}$`, written only by the installer after a scan |

Baseline carries `license` and `vetted` on the `research` group's entries, as the old manifest did.

Bounds: user file a regular file (`lstat`, a link is refused), at most 256 KiB, at most 200 entries. A bad file → empty user layer, `ERROR user catalog: <file too large|link|bad JSON>`. A bad entry → `ERROR user catalog entry <n>: <field> <reason>`, its text never echoed; it cannot be selected and nothing from it installs. Baseline entries still work. A bad baseline → `check.mjs` fails; at run time `ERROR baseline catalog`, exit 1.

**Merge:** on a name clash the baseline wins and the clash is reported, except a user entry with the same source and a `skillcommit`, which pins that baseline entry for Role skill installs only. `/aico:setup` groups read the baseline alone, so their commands never change with the user file.

## Exports
`userCatalogPath({ home })`, `readBaseline()`, `readCatalog({ home })` → `{ entries, errors, clashes }`, `validateEntry(entry, layer)`, `expandGroups(baseline, groups)`, `eligibleRoles(entry, categories)`, `selectable(entry)`, `approvable(scan, hash)`, `boundedFolderHash(dir)`, `skillStatus(entry, { home, productRoot })`, `addUserEntry(entry, { home })`, `setBoundHash(name, hash, { home })`. Writes are atomic (temp file, then rename) and keep every other entry's values.

## Status (`skillStatus`; only `lstat`, `readdir` and file reads)
No child process, no parsing of `skillinstaller`, no network, no link followed. Place checked: `<product root>` first, then `<user home>`, under `.claude/skills/<name>` and `.agents/skills/<name>`.
- Repo entry with commit: `installed` = a real folder (`lstat`; the CLI's `.claude/skills/<name>` is usually a link, so `.agents/skills/<name>` is the one hashed) whose `boundedFolderHash` equals `hash`; `not verified` = present, but the hash differs, none is bound, it is a link with no real folder, or it is over the bound; `missing` = nothing there.
- Installer or unpinned baseline repo entry: `installed (name only)` = a folder or link of that name, version not checked; `not found` = none, which is not proof, since an installer may write elsewhere.
- Plugin entry: `checked at run start`.
- `boundedFolderHash`: the same files, order and bytes as `skillFolderHash` of `skillspector-scan` (a test holds them equal); refuses a link at the top, at most 2000 files and 64 MiB, over → null.

## Error cases
A stored selection outside the catalog or the Role's categories: `aico-settings` `ignored`, never dispatched. Any stop before Save in `/aico:add-skill` writes nothing. A user catalog that cannot be written → `ERROR user catalog: cannot write`, nothing changed.
