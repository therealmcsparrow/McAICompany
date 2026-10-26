# Contract: rule-check v1

Provider: `scripts/rule-check.mjs`. Bindings: `.company/checks.json` (written by `aico:senior-engineer`; CEO, Brief Gate Q6). Consumers: the pre-filter in `aico:pipeline` §2 (runs before the Code Reviewer and in the audit lane), the Code Reviewer and the compliance pass, `aico:senior-engineer` (rule slices, slice files, drift fixes), builders (slice files, through the `Rule slice:` dispatch line, `dispatch-prompt` v3.1).
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
| `slices <senior-engineer handoff>` | checks `## Rules per task`: every task line lists every security Must (IDs with `-SEC` and every rule in a committed pack's `## Security`); prints the gaps; exit 1 when any (AC23). Fix round 4, additive: when the Handoff's folder has a `rules/` folder, it also checks the slice files ("Slice files"): each row has its file and each file equals a fresh render byte for byte; `slice missing: <task>`, `slice stale: <task>` or `slice without row: <file>` are gaps too |
| `slices <senior-engineer handoff> --write` | (Fix round 4) writes the slice files of every row into `<Handoff folder>/rules/` ("Slice files"), then runs the check above; prints `wrote <n> slices` plus any gaps; exit 1 on a gap or a refusal |
| `drift` | exit 1 when a binding's `rule` is missing, its `text` hash no longer matches the rule, or a Project rule has a `check:` ID with no binding |

## Slice files (Fix round 4)
A builder reads only its task's slice file, never the senior-engineer Handoff or the whole ruleset. Reason: in T15b the builder read the 16,765-byte Handoff 04, which holds rule IDs for every task but no rule text, and its spend rose 37.1% (`48-ai-data-engineer.md`).
- **Path:** `.company/work/<slug>/rules/<task>.md`, `<slug>` = the senior-engineer Handoff's folder, `<task>` = the row's first cell, which must match `^[A-Za-z0-9][A-Za-z0-9-]{0,15}$` (else `refused: bad task id <first 35 chars>`). Committed with the senior-engineer Step.
- **Writer:** `slices --write` only. The senior-engineer owns the content (the row and its focus notes) and runs the command; nobody edits a slice file by hand (a hand edit shows as `slice stale`).
- **Layout** (LF, rendered from the row, labels exact):
```markdown
---
task: T2c
source: .company/work/<slug>/<NN>-senior-engineer.md
---
## Rules
- proj.M11 — <the rule's text from .company/standards.md or the committed pack, cut at 200 characters on a word boundary, then …>
## Focus
> <the row's focus: segment, verbatim, one line, cut at 1000 characters>
## Security
proj.M-SEC1, proj.M-SEC2, agentsec.M-SEC1, …
```
  - `## Rules`: every non-security ID of the row, in row order, duplicates removed, each with its text. `## Focus`: the text between `focus:` and `; security:` in the row, or `(none)`. `## Security`: every security Must ID (AC23) on one line, no text; a builder opens a security Must's source only when its change touches that area, and the Focus notes name the ones that matter for the task.
  - Rule text comes from the same rule lines `drift` hashes (Project rules in `.company/standards.md`, committed packs `.company/standards/*@*.md`). An ID with no rule line → `refused: unknown rule <id> in <task>`, nothing written.
  - Size: at most 6 KiB per file, else `refused: slice <task> over 6 KiB` (the senior-engineer narrows the row), nothing written.
- **File system:** `--write` creates `rules/` when missing, then replaces every `*.md` in it (a task removed from the table loses its file); a symlink or any other entry → `refused: unexpected entry in rules/`, nothing written. Each file is written atomically (temp file plus rename); every path must resolve inside `<Handoff folder>/rules/`.
- **Input is LLM-written:** the Handoff is capped at 64 KiB, rows are matched with anchored linear patterns, and row text is never executed (proj.M1 to M4, agentsec.M-SEC2).

## No ruleset
| State under `<root>/.company/` | `run` | `slices` | `drift` |
|---|---|---|---|
| no `standards.md` and no `checks.json` | `no ruleset`, exit 0 | `no ruleset`, exit 0 | `no ruleset`, exit 0 |
| `standards.md`, no `checks.json` | `no checks bound`, exit 0 | normal | exit 1 if any Project rule has a `check:` ID, else 0 |
| `checks.json`, no `standards.md` | `T-0 tool config invalid` | `no ruleset`, exit 0 | exit 1 (every binding points at a missing rule) |
Only full absence is quiet; a half-present ruleset fails closed. With `no ruleset`, `--write` writes nothing and builders get no `Rule slice:` line.

## Flow (AC22)
1. Tool checks run first: the Lead runs `run` with the pre-filter and passes the rows (and `list`) to the reviewer.
2. A `T-` row blocks only after the reviewer confirms it: confirmed → a Blocking row with the same `T-` ID (`handoff` v1.1); rejected → a Nit row `T-<n> | <file>[:<line>] | not confirmed | <why> | none` (the `handoff` v1.1 part 2 Nit form, same `T-` ID).
3. A tool that cannot run, crashes or times out is a `T-` row `tool failed: <check-id>`, never silence. `check.mjs` exiting 1 on `ERROR` lines is not a crash.
4. `drift` runs in `npm test` (`scripts/rule-check.test.mjs`): on fixtures always, and on the real `<root>` when `.company/standards.md` exists (the test is skipped with `no ruleset` otherwise, as in CI). The Lead also runs `drift` after each ruleset sign-off and before the Ship Gate, where the real files exist.
5. Drift routing (below).
6. Slices (Fix round 4): before dispatching a builder the Lead runs `slices <latest senior-engineer map Handoff>`; exit 1, or no slice file for the builder's task → back to the Senior Engineer as a normal Step, not a Fix round (same route as a gap). A ruleset sign-off that changes rule text makes slices stale, so the Senior Engineer re-runs `--write` after it.

## Drift routing (Lead)
A stale binding is a ruleset bookkeeping fault, not a builder's fault, so it never goes to a builder or a reviewer.
- **`drift` exit 1** (after a sign-off, before the Ship Gate, or a red drift test in `npm test`, shown by a pre-filter `node-test` row that names a `rule-check` test) → the Lead dispatches `aico:senior-engineer` as a normal Step with the `drift` output in its Goal. It is **not a Fix round**: it never counts toward `pipeline.fix_rounds`, the same as a `slices` gap. The builder whose Step surfaced the red drift test is not sent back for it.
- **What the Senior Engineer may fix alone:** `.company/checks.json` only. That means pointing a binding at the right rule ID, adding a missing binding for a `check:` ID, removing a binding whose rule was removed with a sign-off, or rehashing `text`. A rehash is allowed only when the changed rule text was signed off in this run (the Architect's `ruleset signed off` Decision). Otherwise it would launder an unsigned rule change.
- **What needs a sign-off first:** any fix that changes `.company/standards.md`, such as editing a Must's text or dropping or changing its `check:`, and any rehash of rule text nobody signed off. These go to the Architect for sign-off (`aico:ruleset`) and then back through this route.
- After the Senior Engineer's Step the Lead runs `drift` again. If it still exits 1 after that **one** Step, the Lead asks the CEO in a form with the `drift` output. There is no second automatic round.
- **The Ship Gate never opens on a red `drift`.** Its summary states `drift: clean` or `drift: no ruleset`.
- **`drift` exit 2** with a malformed `checks.json` takes the same route. `refused: bad root` is the Lead's own working-directory error: the Lead fixes it and reruns, with no dispatch.

## Error cases
- `base` not `^[0-9a-f]{7,40}$` → `refused: bad base`, exit 2.
- `--root` not an existing directory → `refused: bad root`, exit 2.
- Malformed `checks.json` (bad JSON, unknown key, `argv` not a list of strings, > 64 KiB) → exit 2 with the reason; the pre-filter reports it to the reviewer as `T-0 tool config invalid`.
- `slices --write` refusals (bad task ID, unknown rule, over 6 KiB, unexpected entry in `rules/`) → exit 1, nothing written.
