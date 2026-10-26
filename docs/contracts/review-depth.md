# Contract: review-depth v1

Provider: `scripts/review-depth.mjs`. Consumer: `aico:pipeline` §2 (the `Review depth:` line, `dispatch-prompt` v3.1), the Code Reviewer and, from part M, the Blast Radius mod (`aico-mods` v1).
Depth follows the touched paths, never the builder's label (AC24).

## CLI
`node review-depth.mjs <base-sha> [--risk low|medium|high]` → stdout first line `full` or `standard`, then one `reason: <path> — <rule>` line per path that forced `full`; exit 0. Bad `<base-sha>` (not `^[0-9a-f]{7,40}$`) or bad `--risk` → `refused: <reason>`, exit 2. Paths come from `git diff --name-only <base-sha>..HEAD` via `execFile` (no shell).

### Part M additions (additive, still unshipped; the text output above is unchanged)
- `node review-depth.mjs --staged [--risk …] [--repo <dir>]`: paths from `git diff --cached --name-only` (no HEAD yet: `git diff --cached --name-only --root` equivalent, every staged path).
- `node review-depth.mjs --worktree [--risk …] [--repo <dir>]`: paths from `git diff --name-only HEAD` plus `git diff --cached --name-only` plus `git ls-files -z --others --exclude-standard --full-name -- :/` (staged, unstaged and untracked, ignored files left out; what a commit run after `git add` can include).
- `<base-sha>`, `--staged` and `--worktree` are mutually exclusive; exactly one is required (`refused: give one of <base-sha>, --staged, --worktree`).
- `--repo <dir>`: run git with `-C <dir>`; `<dir>` must resolve (realpath) inside the cwd's repository top level or equal it, else `refused: repo outside the project`.
- `--json`: instead of the text lines, one JSON object on stdout:
  ```json
  { "v": 1, "source": "base|staged|worktree", "base": "<sha>|null", "tier": "low|medium|high|unknown",
    "depth": "full|standard",
    "paths": [{ "path": "docs/contracts/x.md", "categories": ["contract"], "module": "ledger|null" }],
    "reasons": [{ "path": "docs/contracts/x.md", "rule": "contract path" }],
    "truncated": false }
  ```
  `tier` echoes `--risk` (absent → `unknown`; depth rules unchanged, so `unknown` is not `high`). `paths` lists at most 500 entries (`truncated: true` past that; depth is still computed over all paths).

## `full` when any of these holds
1. `--risk high`.
2. A touched path is, or is under, a path listed in `.company/project.md` `## Core` (the text before the first `:` of each item). Category `core`.
3. A Contract path: `docs/contracts/**`, any `contracts/` folder, `*.proto`, `openapi.*`, `asyncapi.*`. Category `contract`.
4. A security path: a name or folder containing `auth`, `login`, `session`, `token`, `secret`, `crypt`, `password`, `payment`, `billing`, `permission`; `migrations/**`; `.github/workflows/**`; `agents/*.md`; `.company/standards.md`, `.company/standards/**`, `.company/checks.json`, `.company/settings.json`; `package.json`, lockfiles, `deps/**`. Part M adds `hooks/**` and `mods/**` (code that runs on every tool call). Category `security`.
5. The diff can't be read → `full` with `reason: diff unavailable`; in `--json`, `paths: []` and one reason `{ "path": "*", "rule": "diff unavailable" }`.

A path may carry several categories. Otherwise `standard`. The reviewer may raise `standard` to `full`, never lower it.

## Modules (part M, `--json` only)
`module` names the `.company/project.md` `## Modules` item a path belongs to; it never changes depth. Item name = the text before the first `:` of the line (`(none yet)` and comment lines ignored).
- A name containing `/` is a path prefix, matched like a Core item.
- Any other name matches a path when a directory segment of the path, or the file name without its last extension, equals the name.
- First matching item in file order wins; none → `null`.
