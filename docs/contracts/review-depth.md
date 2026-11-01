# Contract: review-depth v1.3

v1.3 (task context-cap-enforcement T3; additive): `--json --lines` adds `lines` to every `paths[]` entry: added plus deleted lines from the numstat of the judging diff (same flags and endpoints as the path list), a binary file counts 0. Base mode with `--lines` and no usable profile at the base (missing, over 64 KiB or no `## Core`) still lists every changed path (`module: null`, `categories` as with an empty Core list, `lines`, the 500 cap and `truncated` as usual) while `depth` stays `full` and `reasons` stays the one row `{ "path": "*", "rule": "core unknown at base" }`; depth is never lowered. `--lines` without `--json` is `refused: --lines needs --json`. Without `--lines` every output is byte-unchanged. Consumer: `step-split` v1.

v1.2 (`docs/adr/0007-contract-minor-versions.md`): `--run` takes a run name. A run name is a work folder name of `work-folder-name` v1 (new name or legacy slug, `isWorkFolder`); the run ref is `refs/heads/aico/` plus `branchId(name)` (the legacy slug unchanged, never the literal new name). The id is checked against `^[a-z0-9][a-z0-9-]{0,127}$` before any git call. A new-name run on its own branch is not `head not on run branch`.

v1.1 (task v020-gate-roadmap, T2; `docs/adr/0007-contract-minor-versions.md`): base mode takes the full base id and `--run <slug>` and reads the diff as the judging diff of rule git.M-SEC4 (the call form is in `rule-check` v1.1, "Judging diff and run ref"); `## Core` and `## Modules` come from `.company/project.md` at the base commit; a grafts file, a HEAD that is not the run ref or an unreadable base profile gives `full`; `--staged` and `--worktree` carry every judging flag. A v1 caller (`<sha>` without `--run`) gets `full` with `reason: no run ref`.

Provider: `scripts/review-depth.mjs`. Consumer: `aico:pipeline` §2 (the `Review depth:` line, `dispatch-prompt` v3.1), the Code Reviewer and, from part M, the Blast Radius mod (`aico-mods` v1).
Depth follows the touched paths, never the builder's label (AC24).

## CLI
`node review-depth.mjs <full base id> --run '<name>' [--risk low|medium|high]` → stdout first line `full` or `standard`, then one `reason: <path> — <rule>` line per path that forced `full`; exit 0. A base that is not `^[0-9a-f]{40}$` or `^[0-9a-f]{64}$`, a bad `--run` name or a bad `--risk` → `refused: <reason>`, exit 2. Paths come from the judging diff `-z --name-only --no-renames` from the base to `refs/heads/aico/<slug>`, run by `execFile` (no shell) from the top level with grafts and replace refs off and every inherited `GIT_*` key dropped. `--run` belongs to base mode only; `--staged` and `--worktree` refuse it.

### Part M additions (additive, still unshipped; the text output above is unchanged)
- `node review-depth.mjs --staged [--risk …] [--repo <dir>]`: paths from the judging diff with `--cached` (no HEAD yet: every staged path).
- `node review-depth.mjs --worktree [--risk …] [--repo <dir>]`: paths from the judging diff against `HEAD` plus the judging diff with `--cached` plus `git ls-files -z --others --exclude-standard --full-name -- :/` (staged, unstaged and untracked, ignored files left out; what a commit run after `git add` can include). Both diffs carry every flag and env key of the judging diff, so `diff.ignoreSubmodules`, a textconv driver, `diff.external` and `core.fsmonitor` change nothing and a changed submodule is listed. These two modes list what the next commit holds, not what a run changed: they take no `--run` and never go `full` for a missing run ref.
- `<base>`, `--staged` and `--worktree` are mutually exclusive; exactly one is required (`refused: give one of <base>, --staged, --worktree`).
- `--repo <dir>`: run git with `<dir>` as the directory it starts in; `<dir>` must resolve (realpath) inside the cwd's repository top level or equal it, else `refused: repo outside the project`.
- `--json`: instead of the text lines, one JSON object on stdout:
  ```json
  { "v": 1, "source": "base|staged|worktree", "base": "<full id>|null", "tier": "low|medium|high|unknown",
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
6. Anything else that leaves the diff unjudged, with the same shape and the reason as the rule text: `no run ref` (base mode without `--run`), `grafts file present` (every mode; a graft-path query that fails or prints nothing counts, and `GIT_GRAFT_FILE` is dropped from the inherited environment), `head not on run branch` (base mode: `git symbolic-ref -q HEAD` is not `refs/heads/aico/<slug>`), `core unknown at base` (base mode: `.company/project.md` is missing at the base commit, over 64 KiB or has no `## Core`). The Blast Radius mod counts every such `*` reason except the risk tier as an unknown Security hit.

A path may carry several categories. Otherwise `standard`. The reviewer may raise `standard` to `full`, never lower it.

## Modules (part M, `--json` only)
`module` names the item of `## Modules` in `.company/project.md` (at the base commit in base mode, else the working copy) a path belongs to; it never changes depth. Item name = the text before the first `:` of the line (`(none yet)` and comment lines ignored).
- A name containing `/` is a path prefix, matched like a Core item.
- Any other name matches a path when a directory segment of the path, or the file name without its last extension, equals the name.
- First matching item in file order wins; none → `null`.
