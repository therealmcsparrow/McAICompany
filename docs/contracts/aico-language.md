# Contract: aico-language v1

Provider: `scripts/language.mjs`. Consumers: `aico:pipeline` Setup §1.6, `aico:language` (command), `aico:ruleset` (library packs), Lead-only Playbooks.
`aico_language` is the language aico **writes in**. It is not `languages:` (the product's UI locales; Localizer).

## Storage
- **User default:** `<MCSPARROW_HOME>/config.json`, key `aico_language` (string, BCP 47). `MCSPARROW_HOME` env var, else `~/.mcsparrow`. Other keys in the file are preserved on write. File or key missing = no default.
- **Project override:** one line `aico_language: <tag>` in the header block of `.company/project.md`, directly after `languages:`. Absent = no override. The project template ships without the line.

## Resolution
Effective = project override, else user default, else `en`. A stored value that fails validation is skipped (warning on stderr) and resolution falls through to the next level.

## CLI (Node ESM, no dependencies, cwd = product repo)
| Command | stdout (exit 0) |
|---|---|
| `node language.mjs` | `<tag>\t<project\|user\|default>` |
| `node language.mjs --default` | `<tag>\t<user\|default>` (ignores the project) |
| `node language.mjs set <tag>` | `set user <tag>` |
| `node language.mjs set <tag> project` | `set project <tag>` |
| `node language.mjs clear` / `clear project` | `cleared user` / `cleared project` |

Exports for tests: `validate(tag) -> {ok, tag, reason}`, `resolve({home, cwd}) -> {tag, source}`, `setLanguage(tag, scope, {home, cwd})`, `clearLanguage(scope, {home, cwd})`.

## Validation
`Intl.getCanonicalLocales(tag)` must not throw, and the primary language subtag must have a name in `new Intl.DisplayNames(['en'], {type: 'language', fallback: 'none'})`. The stored value is the canonical form (`NL` → `nl`, `pt-br` → `pt-BR`).

## Error cases (exit 2, stdout `refused: <reason>`, nothing written)
- invalid or unknown tag: `refused: <tag>: <not a BCP 47 tag | unknown language>`
- `project` scope and no `.company/project.md`: `refused: no .company/project.md`
- unknown subcommand or extra arguments: `refused: usage: language.mjs [--default | set <tag> [project] | clear [project]]`
- unreadable/invalid JSON in config.json on `set`: `refused: <path> is not valid JSON` (file left untouched)
