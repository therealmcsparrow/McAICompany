# Contract: rule-pack v1.1

Provider: `aico:senior-engineer` (`/aico:standards` runs and refresh Steps). Validator: `checkPack(text, { file, today, advisories })` exported by `scripts/check.mjs` (Core). Consumers: every Role that loads rules (`aico:ruleset`), `rule-check` v1.
v1.0 = the pack format in `skills/ruleset/SKILL.md` §Pack format at 0.10.0. v1.1 is additive: every valid v1.0 pack is a valid v1.1 pack. The committed copies in `.company/standards/` at base `bea3242` are the reference: all of them must pass.

## Format (v1.0, now checked)
- File `<tool>@<major>.md`; frontmatter `tool` equals `<tool>`, `versions` non-empty, `researched` a real `YYYY-MM-DD` date not after today.
- Sections: only `## Must`, `## Should`, `## May`, `## Security`, each at most once. HTML comments are allowed anywhere.
- Rule line: `- <prefix>.<tier><n> — <rule>[ — why: <…>] — source: <source>[ , <source>…]`.
  - `<prefix>` matches `^[a-z][a-z0-9-]{0,23}$` and **need not equal `tool`** (`nsrv.` in `nodejs-server@2026.md`, `cc.` in `claude-code-plugins@2026.md`). One prefix per pack. `proj` is reserved for `.company/standards.md` `## Project rules`.
  - `— why: <…>` is **optional** (most v1.0 lines have none).
  - Tier letter matches the section: `M` in Must, `S` in Should, `Y` in May, `M-SEC` in Security. IDs unique in the pack. Must and Security lines need at least one `https://` source.
- Parsing: the line is split only at the literal markers ` — why: `, ` — source: `, ` — enforced-by: `, ` — check: `, each at most once, in that order. A plain ` — ` inside `<rule>` or `why` is text.

## Added in v1.1
- Optional suffix at the end of a rule line: `— enforced-by: <linter rule>` (information only, as before).
- `— check: <check-id>|judgment` is allowed **only** on `.company/standards.md` `## Project rules` lines (after `enforced-by:` when both are present). `<check-id>` matches `^[a-z0-9][a-z0-9-]{0,40}$` and is bound in `.company/checks.json` (`rule-check` v1). A Project rule without `check:` counts as `check: judgment`.
- Pack lines (library and committed copies) never carry `check:`: a shared pack is used by many projects, and a tag there would fail every project's `drift` until it binds the ID. A pack rule is tool-checked only through a binding whose `rule` names it in the project's `.company/checks.json`.
- `advisories.json` next to the packs in the library: `[{ "tool": "<tool>", "date": "YYYY-MM-DD", "id": "<CVE or vendor ID>", "source": "<https URL>" }]`, at most 256 KiB, written by the Senior Engineer or Security when they read an advisory. A missing file means no known advisory.

## Freshness checks
| Mode | Command | Errors |
|---|---|---|
| Library (warm reuse, AC29) | `node check.mjs --packs <dir>` | format; `researched` more than 90 days before today; an `advisories.json` entry for the tool dated after `researched` |
| Repo | `node check.mjs` scans `<root>/.company/standards/*@*.md` | format; `researched` more than 180 days before today (the Stale rule in `aico:ruleset`); a rule ID used in two committed packs |

The 90-day rule governs reusing a library pack for a new project, so it is checked on the library, not on a project's committed copies. `today` is injectable for tests.

## No ruleset (CI and fresh clones)
`.company/` may be untracked (here: the global gitignore), so CI and a fresh clone have no committed copies. Repo mode with no `<root>/.company/standards/` directory prints `no ruleset` once and adds no error. CI proves `checkPack` on fixtures (`tests/fixtures/packs/`); the real copies are checked wherever they exist, i.e. on the Lead's machine (`docs/adr/0012-ruleset-stays-local.md`).

## Error cases
Each error names the pack file and the rule, for example `ERROR react@19.md: rule react.S4 in ## Must (tier letter)`, `ERROR nodejs@26.md: stale (90-day warm rule, researched 2026-06-01)`, `ERROR nodejs@26.md: advisory CVE-2026-1234 (2026-10-21) after researched 2026-10-19`, `ERROR react@19.md: rule react.M3 has check: (bind it in .company/checks.json)`, `ERROR nodejs@26.md: prefix nsrv differs from node (one prefix per pack)`. Size cap per pack 256 KiB.
