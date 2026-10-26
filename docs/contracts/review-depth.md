# Contract: review-depth v1

Provider: `scripts/review-depth.mjs`. Consumer: `aico:pipeline` §2 (the `Review depth:` line, `dispatch-prompt` v3.1) and the Code Reviewer.
Depth follows the touched paths, never the builder's label (AC24).

## CLI
`node review-depth.mjs <base-sha> [--risk low|medium|high]` → stdout first line `full` or `standard`, then one `reason: <path> — <rule>` line per path that forced `full`; exit 0. Bad `<base-sha>` (not `^[0-9a-f]{7,40}$`) or bad `--risk` → `refused: <reason>`, exit 2. Paths come from `git diff --name-only <base-sha>..HEAD` via `execFile` (no shell).

## `full` when any of these holds
1. `--risk high`.
2. A touched path is, or is under, a path listed in `.company/project.md` `## Core` (the text before the first `:` of each item).
3. A Contract path: `docs/contracts/**`, any `contracts/` folder, `*.proto`, `openapi.*`, `asyncapi.*`.
4. A security path: a name or folder containing `auth`, `login`, `session`, `token`, `secret`, `crypt`, `password`, `payment`, `billing`, `permission`; `migrations/**`; `.github/workflows/**`; `agents/*.md`; `.company/standards.md`, `.company/standards/**`, `.company/checks.json`, `.company/settings.json`; `package.json`, lockfiles, `deps/**`.
5. The diff can't be read → `full` with `reason: diff unavailable`.

Otherwise `standard`. The reviewer may raise `standard` to `full`, never lower it.
