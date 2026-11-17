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
- `paths`: the change from `base` to the working tree, read with two calls of the git.M-SEC4 form that share every mode flag (`git diff ... -z -M --name-status --end-of-options <base> --` and `git diff ... -z -M --numstat --end-of-options <base> --`; git.M-SEC4 rename reading), plus untracked files that git does not ignore (`git ls-files --others --exclude-standard`), sorted by `path`, at most 5000 entries. `path` and `from` are repo-relative with `/`; `from` is the old path of a rename or copy, else `null`. `status` is one of `A M D R C T` (untracked = `A`).
- More than 5000 entries: the first 5000 are kept, `truncated` is `true`, `ui_changed`, `strings_changed` and `contract_changed` are `true`, and `docs_only` is `false` (each flag at its fail-safe value).
- Paths are data. A path is stored with kind `unknown` (no rule below is tried) when `path` or `from` has a control character (U+0000 to U+001F, U+007F), a `..` segment, a segment that starts with `-`, a U+FFFD (a name that is not valid UTF-8 is decoded with replacement), or more than 4096 UTF-8 bytes.
- Output never carries a raw control character: JSON on stdout escapes U+0000 to U+001F and U+007F as `\uXXXX`; stderr never echoes a path.

## Kinds (first match wins)
A path is matched on `path`; a deleted path on its old path. A rename (`R`) that rules 1 to 3 did not catch is matched on both `path` and `from`; when the two kinds differ, its kind is `unknown`. A copy (`C`) is matched on `path` only (its `from` is unchanged), except for rule 2. Globs use `/` and are case-sensitive.
| # | kind | rule |
|---|---|---|
| 1 | `binary` | the base or tip content has a NUL byte in its first 8000 bytes (in `classify` entries: `added` and `removed` each `null` or `"-"`) |
| 2 | `contract` | `**/contracts/**` (any depth, so `docs/contracts/**` and `tests/contracts/**` too), `**/*.proto`, `**/openapi*.json`, `**/openapi*.yaml`, `**/openapi*.yml`, `**/*.schema.json`; also when `from` matches one of these |
| 3 | `rename` | status `R` with similarity 100 and 0 lines added and removed |
| 4 | `test` | `tests/**`, `test/**`, `**/__tests__/**`, `**/fixtures/**`, `**/*.test.*`, `**/*.spec.*` |
| 5 | `docs` | `docs/**`, `documentation/**`, `.company/**`, a root `*.md`, a root `LICENSE*`, minus every `not_docs` glob of the config |
| 6 | `locale` | `**/locales/**`, `**/locale/**`, `**/i18n/**`, `**/l10n/**`, `**/*.po`, `**/*.pot`, `**/*.ftl`, `**/*.arb`, `**/*.resx`, `**/*.xlf`, `**/*.xliff`, `**/*.strings` |
| 7 | `style` | `**/*.css`, `**/*.scss`, `**/*.sass`, `**/*.less`, `**/theme/**`, `**/themes/**`, `**/tokens/**`, `**/theme.*`, `**/tokens.*`, `**/*.theme.*`, `**/*.tokens.*` |
| 8 | `ui` | `**/*.html`, `**/*.htm`, `**/*.jsx`, `**/*.tsx`, `**/*.vue`, `**/*.svelte`, `**/*.svg`, `**/*.xaml` |
| 9 | `config` | `.github/**`, `**/*.json`, `**/*.yml`, `**/*.yaml`, `**/*.toml`, `**/*.ini`, `**/.env*`, `**/*.config.*`, `**/.*rc` |
| 10 | `code` | `**/*.mjs`, `**/*.cjs`, `**/*.js`, `**/*.ts`, `**/*.py`, `**/*.go`, `**/*.rs`, `**/*.java`, `**/*.kt`, `**/*.cs`, `**/*.rb`, `**/*.php`, `**/*.swift`, `**/*.c`, `**/*.h`, `**/*.cpp`, `**/*.sh`, `**/*.ps1`, `**/*.md` |
| 11 | `unknown` | anything else |

Binary by content (git.M-SEC4 (3)): attributes, a diff driver and `core.bigFileThreshold` never decide rule 1. The CLI reads each path's base blob and tip content raw (`cat-file`, never `--textconv` or `--filters`; for `write` the tip is the working-tree file, read by the real-path rule; an added path has no base, a deleted one no tip) and passes `added` and `removed` as `"-"` when either side has a NUL in its first 8000 bytes. Tip content the real-path rule refuses (a link, not a plain file) counts as binary. A path numstat shows as `-` `-` whose sides are both NUL-free is text: its counts come from the one-path call of git.M-SEC4 (3) (`--name-only -z -- <path>` must list exactly that path, then `--numstat --text -z -- <path>`). Any of these calls failing is a refusal (git.M-SEC4 (4)). The raw reads are one `cat-file --batch-check` sizing pass, one `cat-file --batch` process for small blobs and, for a larger blob, `cat-file blob --end-of-options <id>:<path>` stopped once 8000 bytes arrived, under the git.M-SEC4 batch and prefix readings (`.company/standards.md`); a `--batch` header that differs from its sizing line, a stop before 8000 bytes or a full read whose length differs from the sized length is a refusal.

Git env: every git call runs in the git.S6 env (caller `GIT_*` stripped) with `GIT_NO_LAZY_FETCH=1` set by the script, so a judging call in a partial clone never reaches the network; an object that is not present counts as binary. Every `diff` call carries the global `--attr-source <empty tree id>` (git.M-SEC4 attr-source reading), so no committed or working-tree `.gitattributes` is read and no `filter=` from one runs a clean command; `$GIT_DIR/info/attributes` is still read. Needs git 2.40 or later; older git rejects the option and every command is refused `git failed`.

## Flags
- `ui_changed` is `false` only when `paths` is not empty and every kind is `docs` or `test`. An empty diff gives `true`.
- `strings_changed` is `false` only when `paths` is not empty and every kind is `docs`, `test` or `style`.
- `contract_changed` is `true` when any kind is `contract`, `binary` or `unknown`, or `truncated` is `true`.
- `docs_only` is `true` only when `paths` is not empty and every kind is `docs`.

## Config (optional, narrow only)
`diff-facts.config.json` at the repo root, a plain file of at most 16 KiB: `{ "v": 1, "not_docs": ["<glob>", ...] }`, at most 100 globs. It is not checked for being tracked: it can only move paths out of `docs`, and an edit to it, tracked or untracked, is itself a `config` path in `paths`. A path matching a `not_docs` glob skips rule 5 and goes on to rule 6. The config can only move paths out of `docs`, so it can only turn flags to `true`. A missing config is normal; a bad one (link, too big, bad JSON, wrong keys) is ignored with one warning `diff-facts: config ignored: <reason>` on stderr, and no path is `docs`.

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2)
| Command | Does |
|---|---|
| `write <slug> <NN-role>` | Reads the run's Base commit from the Step's Handoff frontmatter `base-commit`, writes the facts file, prints its path. Refused for a bad slug or step, no Handoff, a file that exists, or a git error; nothing written. Refused `not on the run branch` unless the trimmed output of `git symbolic-ref -q HEAD` equals `refs/heads/aico/<branchId(slug)>` byte for byte (`branchId`, `work-folder-name` v3.0; `null` refuses too), so the working-tree tip is only ever the run's own branch (git.M-SEC4 (1)). |
| `show --base <commit> --head <commit>` | Prints the facts object for `base..head` as one JSON object (the facts-file keys without `step`; commits only, no working tree), writes nothing. Both commits are required and must be full 40-hex lowercase ids, else refused before git runs (`--head is required`; `show` never fills a side from `HEAD`); an id not in the repo is refused. Its output is a judging result only under the git.M-SEC4 CI reading; anywhere else (`route.mjs dry`) it is a preview and never sets a skip, a Gate or a pass. Reads `diff-facts.config.json` from the working tree at cwd. |
| `show ... --github-output` | Also appends `docs_only=<bool>` and `ui_changed=<bool>` to the file named by `GITHUB_OUTPUT`; nothing else is written. A refusal appends nothing. |
| `latest <slug>` | Prints the path of the newest facts file of the run (highest `NN`, compared as a number), or `none`. |
Exports:
- `classify(entries, config)`: pure, never mutates its input. Entries are `{ path, from, status, added, removed, similarity }`; `config` is the parsed config or `null`. Returns `{ paths, truncated, ui_changed, strings_changed, contract_changed, docs_only }`, each path exactly `{ path, from, status, kind }`.
- `readLatest(runDir)`: `runDir` is `.company/work/<parts>`; reads the highest-`NN` file in `<runDir>/facts/` and returns its object, or `null`. `null` when the folder or file is missing or a link, or the newest file is bad (fails any `## Facts file` rule, incl. missing or extra keys); never falls back to an older file.

## Readers
A reader that gets `null`, a parse error, a file over 1 MiB or `v` other than `1` treats `ui_changed`, `strings_changed` and `contract_changed` as `true` and `docs_only` as `false`.

## Compatibility
v1.0. A new kind, a new optional key or a new `not_docs`-style narrowing key is a minor bump. Changing a flag rule toward its unsafe value (`false` for `ui_changed`, `strings_changed`, `contract_changed`; `true` for `docs_only`), removing a key or a widening config key is a major bump and needs the CEO.
