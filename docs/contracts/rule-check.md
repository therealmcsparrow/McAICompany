# Contract: rule-check v1

Provider: `scripts/rule-check.mjs`. Bindings: `.company/checks.json` (written by `aico:senior-engineer`; CEO, Brief Gate Q6). Consumers: the pre-filter in `aico:pipeline` §2 (runs before the Code Reviewer and in the audit lane), the Code Reviewer and the compliance pass, `aico:senior-engineer` (rule slices).
Rationale: `docs/adr/0010-tool-checks-by-id.md`, `docs/adr/0012-ruleset-stays-local.md`. Compliance stays a separate lane.

## Bindings file `.company/checks.json`
```json
{ "version": 1,
  "checks": {
    "aico-check": { "rule": "proj.M5",  "text": "<sha256 of the rule text>" },
    "lf":         { "rule": "proj.M11", "text": "<sha256>" },
    "node-test":  { "rule": "proj.M12", "text": "<sha256>" },
    "eslint":     { "rule": "react.M3", "text": "<sha256>", "argv": ["npx", "eslint", "--format", "json", "."] } } }
```
- A key is a `<check-id>`. `rule` is the one rule it proves: a Project rule that carries `check: <check-id>`, or a pack rule (packs carry no tag, `rule-pack` v1.1). `text` is the SHA-256 of the rule line's `<rule>` field as written.
- **Binding test:** bind a check to a rule only when every failure the check reports is a breach of that rule. A check whose failures have many causes (for example `node-test` against a narrow test-style rule) would cite the wrong rule on most rows.
- **Built-in IDs** (no `argv`):
  - `aico-check`: runs `scripts/check.mjs`; one row per `WARN <file>: <kind> <n> > <max> lines` line. `ERROR` lines are not rule rows; `npm run check` in CI and QA already fails on them.
  - `lf`: one row per changed text file that contains a CR byte. Changed files = `git diff -z --name-only --diff-filter=ACMR <base>..HEAD`; text = not reported as binary by `git diff --numstat` (`-` counts). One more row when `.gitattributes` no longer has the line `* text=auto eol=lf`.
  - `node-test`: runs `npm test`, timeout 300 s; one row when it exits non-zero, naming the first failing test (cut to 120 characters).
  - `handoff-lint`: `scripts/handoff-lint.mjs` over the Step's Handoff.
- **Project IDs** carry `argv`: run with `execFile`, no shell, cwd = `<root>`, 120 s timeout, 1 MiB output cap. Rule text is never executed or interpolated into a command.

## CLI
Every command takes `--root <dir>` (default: the current directory, which the Lead sets to the repo root). Tests pass a temp dir with fixture files (proj.M8) and never run `node-test` against the real repo, so the suite never calls itself.
| Command | Result |
|---|---|
| `run --base <sha>` | runs every check bound to a rule in force (committed packs plus Project rules) over the diff `<sha>..HEAD`; prints one row per failure: `T-<n> \| <file>[:<line>] \| <problem> \| <rule-id>: <rule text, cut to 120 chars> \| <fix or "see rule">`; exit 0 (additive: never closes a review, never `status: done`, never consumes a Fix round) |
| `list` | prints `<rule-id> <check-id>` for every binding, so a reviewer knows which rules a tool already covers; exit 0 |
| `slices <senior-engineer handoff>` | checks `## Rules per task`: every task line lists every security Must (IDs with `-SEC` and every rule in a committed pack's `## Security`); prints the gaps; exit 1 when any (AC23) |
| `drift` | exit 1 when a binding's `rule` is missing, its `text` hash no longer matches the rule, or a Project rule has a `check:` ID with no binding |

## No ruleset
| State under `<root>/.company/` | `run` | `slices` | `drift` |
|---|---|---|---|
| no `standards.md` and no `checks.json` | `no ruleset`, exit 0 | `no ruleset`, exit 0 | `no ruleset`, exit 0 |
| `standards.md`, no `checks.json` | `no checks bound`, exit 0 | normal | exit 1 if any Project rule has a `check:` ID, else 0 |
| `checks.json`, no `standards.md` | `T-0 tool config invalid` | `no ruleset`, exit 0 | exit 1 (every binding points at a missing rule) |
Only full absence is quiet; a half-present ruleset fails closed.

## Flow (AC22)
1. Tool checks run first: the Lead runs `run` with the pre-filter and passes the rows (and `list`) to the reviewer.
2. A `T-` row blocks only after the reviewer confirms it: confirmed → a Blocking row with the same `T-` ID (`handoff` v1.1); rejected → a Nit `T-<n> not confirmed — <why>`.
3. A tool that cannot run, crashes or times out is a `T-` row `tool failed: <check-id>`, never silence. `check.mjs` exiting 1 on `ERROR` lines is not a crash.
4. `drift` runs in `npm test` (`scripts/rule-check.test.mjs`): on fixtures always, and on the real `<root>` when `.company/standards.md` exists (the test is skipped with `no ruleset` otherwise, as in CI). The Lead also runs `drift` after each ruleset sign-off and before the Ship Gate, where the real files exist.

## Error cases
- `base` not `^[0-9a-f]{7,40}$` → `refused: bad base`, exit 2.
- `--root` not an existing directory → `refused: bad root`, exit 2.
- Malformed `checks.json` (bad JSON, unknown key, `argv` not a list of strings, > 64 KiB) → exit 2 with the reason; the pre-filter reports it to the reviewer as `T-0 tool config invalid`.
