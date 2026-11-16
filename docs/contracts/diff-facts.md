# Contract: diff-facts v1.0

Provider: `scripts/diff-facts.mjs` (Node built-ins and `git` only; plan task P20261116.000003-T4). Consumers: `scripts/route.mjs` (`route` v1.0: Role skips and the merge test), `.github/workflows/ci.yml` (docs-only skip and the a11y job, `test-run` v1.2), `scripts/step-key.mjs` (none in v1.0; read-only later). The Lead runs `write` once per Step; no consumer recomputes the diff.
Rationale: one classification of a change that every gate reads, so gates never disagree on what changed. Fail-safe: anything unclear counts as UI, strings and Contract (ADR `docs/adr/0075-fail-safe-ui-changed.md`).

## Facts file
`.company/work/<parts>/facts/<NN>-<role>.json` (`<parts>` = `workParts(slug)`, `work-folder-name` v3.0), one per finished Step, created once with exclusive create (`wx`); an existing file is never overwritten. At most 1 MiB, LF, one JSON object:
```json
{ "v": 1, "step": "05-backend-engineer", "base": "<40 hex>", "head": "<40 hex>",
  "paths": [ { "path": "a/b.css", "from": null, "status": "M", "kind": "style" } ],
  "truncated": false, "ui_changed": true, "strings_changed": false, "contract_changed": false, "docs_only": false }
```
- Exactly these keys. `v` is `1`. `step` matches `^\d{2,3}-[a-z][a-z0-9-]{0,40}$`. `base` is the run's Base commit; `head` is `HEAD` at write time.
- `paths`: the change from `base` to the working tree (`git diff --name-status -M --numstat <base>`), plus untracked files that git does not ignore (`git ls-files --others --exclude-standard`), sorted by `path`, at most 5000 entries. `path` and `from` are repo-relative with `/`; `from` is the old path of a rename or copy, else `null`. `status` is one of `A M D R C T` (untracked = `A`).
- More than 5000 entries: the first 5000 are kept, `truncated` is `true`, `ui_changed`, `strings_changed` and `contract_changed` are `true`, and `docs_only` is `false` (each flag at its fail-safe value).
- Paths are data. A path is stored with kind `unknown` (no rule below is tried) when `path` or `from` has a control character (U+0000 to U+001F, U+007F), a `..` segment, a segment that starts with `-`, a U+FFFD (a name that is not valid UTF-8 is decoded with replacement), or more than 4096 UTF-8 bytes.
- Output never carries a raw control character: JSON on stdout escapes U+0000 to U+001F and U+007F as `\uXXXX`; stderr never echoes a path.

## Kinds (first match wins)
A path is matched on `path`; a deleted path on its old path. Globs use `/` and are case-sensitive.
| # | kind | rule |
|---|---|---|
| 1 | `binary` | numstat shows `-` `-` (in `classify` entries: `added` and `removed` each `null` or `"-"`) |
| 2 | `rename` | status `R` with similarity 100 and 0 lines added and removed |
| 3 | `contract` | `docs/contracts/**`, `contracts/**`, `**/*.proto`, `**/openapi*.json`, `**/openapi*.yaml`, `**/openapi*.yml`, `**/*.schema.json`; also when `from` matches one of these |
| 4 | `test` | `tests/**`, `test/**`, `**/__tests__/**`, `**/fixtures/**`, `**/*.test.*`, `**/*.spec.*` |
| 5 | `docs` | `docs/**`, `documentation/**`, `.company/**`, a root `*.md`, a root `LICENSE*`, minus every `not_docs` glob of the config |
| 6 | `locale` | `**/locales/**`, `**/locale/**`, `**/i18n/**`, `**/l10n/**`, `**/*.po`, `**/*.pot`, `**/*.ftl`, `**/*.arb`, `**/*.resx`, `**/*.xlf`, `**/*.xliff`, `**/*.strings` |
| 7 | `style` | `**/*.css`, `**/*.scss`, `**/*.sass`, `**/*.less`, `**/theme/**`, `**/themes/**`, `**/tokens/**`, `**/theme.*`, `**/tokens.*`, `**/*.theme.*`, `**/*.tokens.*` |
| 8 | `ui` | `**/*.html`, `**/*.htm`, `**/*.jsx`, `**/*.tsx`, `**/*.vue`, `**/*.svelte`, `**/*.svg`, `**/*.xaml` |
| 9 | `config` | `.github/**`, `**/*.json`, `**/*.yml`, `**/*.yaml`, `**/*.toml`, `**/*.ini`, `**/.env*`, `**/*.config.*`, `**/.*rc` |
| 10 | `code` | `**/*.mjs`, `**/*.cjs`, `**/*.js`, `**/*.ts`, `**/*.py`, `**/*.go`, `**/*.rs`, `**/*.java`, `**/*.kt`, `**/*.cs`, `**/*.rb`, `**/*.php`, `**/*.swift`, `**/*.c`, `**/*.h`, `**/*.cpp`, `**/*.sh`, `**/*.ps1`, `**/*.md` |
| 11 | `unknown` | anything else |

## Flags
- `ui_changed` is `false` only when `paths` is not empty and every kind is `docs` or `test`. An empty diff gives `true`.
- `strings_changed` is `false` only when `paths` is not empty and every kind is `docs`, `test` or `style`.
- `contract_changed` is `true` when any kind is `contract`, `binary` or `unknown`, or `truncated` is `true`.
- `docs_only` is `true` only when `paths` is not empty and every kind is `docs`.

## Config (optional, narrow only)
`diff-facts.config.json` at the repo root, tracked, a plain file of at most 16 KiB: `{ "v": 1, "not_docs": ["<glob>", ...] }`, at most 100 globs. A path matching a `not_docs` glob skips rule 5 and goes on to rule 6. The config can only move paths out of `docs`, so it can only turn flags to `true`. A missing config is normal; a bad one (link, too big, bad JSON, wrong keys) is ignored with one warning `diff-facts: config ignored: <reason>` on stderr, and no path is `docs`.

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2)
| Command | Does |
|---|---|
| `write <slug> <NN-role>` | Reads the run's Base commit from the Step's Handoff frontmatter `base-commit`, writes the facts file, prints its path. Refused for a bad slug or step, no Handoff, a file that exists, or a git error; nothing written. |
| `show --base <commit> [--head <commit>]` | Prints the facts object for `base..head` as one JSON object (the facts-file keys without `step`; commits only, no working tree), writes nothing. A given `<commit>` must be a full 40-hex lowercase id, else refused before git runs; an id not in the repo is refused. `--head` defaults to `HEAD`. Reads `diff-facts.config.json` from the working tree at cwd. |
| `show ... --github-output` | Also appends `docs_only=<bool>` and `ui_changed=<bool>` to the file named by `GITHUB_OUTPUT`; nothing else is written. A refusal appends nothing. |
| `latest <slug>` | Prints the path of the newest facts file of the run (highest `NN`, compared as a number), or `none`. |
Exports:
- `classify(entries, config)`: pure, never mutates its input. Entries are `{ path, from, status, added, removed, similarity }`; `config` is the parsed config or `null`. Returns `{ paths, truncated, ui_changed, strings_changed, contract_changed, docs_only }`, each path exactly `{ path, from, status, kind }`.
- `readLatest(runDir)`: `runDir` is `.company/work/<parts>`; reads the highest-`NN` file in `<runDir>/facts/` and returns its object, or `null`. `null` when the folder or file is missing or a link, or the newest file is bad (fails any `## Facts file` rule, incl. missing or extra keys); never falls back to an older file.

## Readers
A reader that gets `null`, a parse error, a file over 1 MiB or `v` other than `1` treats `ui_changed`, `strings_changed` and `contract_changed` as `true` and `docs_only` as `false`.

## Compatibility
v1.0. A new kind, a new optional key or a new `not_docs`-style narrowing key is a minor bump. Changing a flag rule toward its unsafe value (`false` for `ui_changed`, `strings_changed`, `contract_changed`; `true` for `docs_only`), removing a key or a widening config key is a major bump and needs the CEO.
