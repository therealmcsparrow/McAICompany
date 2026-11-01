# Contract: reflect v1.2

v1.2 (task input-fix, T10; additive): after the work folder name check, `<slug>` and a `<file>` given as a path inside `.company/work` must match the folder and file names on disk in exact letter case (`exactWorkPath` of `work-folder-name` v1.1). Another letter case → `refused: wrong letter case`, exit 2, nothing read. A run folder missing in every case keeps `refused: no run folder for <slug>`.

Provider: `scripts/reflect.mjs` (Node built-ins only, deterministic, no model call). Consumer: the Reflect mod (`aico-mods` v1).
Reads only: the given Step file, the run's Step files (frontmatter and `## Blocking`), `handoff-lint.mjs` `lint()`, the `ledger.mjs` report data (imported, not spawned; the same numbers as `report --json --live`) and `run-state` v1. Writes nothing.

## CLI (cwd = product repo; `refused: <reason>` on stdout, exit 2)
| Command | stdout (exit 0) |
|---|---|
| `step <slug> <file> --json` | the step check below |
| `retro <slug> --json` | the retrospective below |
`<slug>` is a work folder name (`work-folder-name` v1: a new name `YYYY-MM-DD HH.MM - Topic` or a legacy slug, checked by `isWorkFolder`), else `refused: run must be a work folder name`; `<file>` must be a `^\d{2}-[a-z0-9-]+\.md$` file directly in `.company/work/<slug>/` (resolved with `lstat`, no symlink, at most 64 KiB), else refused.

## Step check
```json
{ "v": 1, "step": "07", "role": "backend-engineer", "status": "done|blocked|needs-ceo|handover|unknown",
  "did": "<text>", "wrong": ["security blocker: 1", "lint: <first error>", "re-dispatch: 2", "handover"],
  "remember": "<text>|null", "lessons": [{ "role": "backend-engineer", "text": "<text>" }] }
```
- `did`: the first bullet under `## Did`, cut to 160 characters; none → `no Did section`.
- `wrong`: one entry per kind, in this order: Blocking items counted per tag (`<tag> blocker: <n>`), the first `handoff-lint` error, re-dispatch (`re-dispatch: <n>` when the ledger holds more than one record with this Step's `id`), `handover` when `status: handover`. Empty when nothing went wrong.
- `remember`: the first bullet under `## Decisions`, cut to 160 characters, else `null`.
- `lessons` (0–3), each one line that passes the `lessons` v1 text rules (else dropped), all for this Step's Role: per Blocking tag present, `<tag> finding in Step <NN>: <first item of that tag, cut to 160>`; on handover, `Step <NN> reached its context cap; split the task or raise the cap`; on a lint error, `Handoff failed lint: <error, cut to 120>`.
- Rendered, the check is at most 5 lines: did, went wrong, remember, suggestions, and the mod's `suggested` label line.

## Retrospective
```json
{ "v": 1, "slug": "x", "outcome": "ship|abort|unknown",
  "top_spend": [{ "step": "07", "role": "…", "spend": 0 }], "top_time": [{ "step": "07", "role": "…", "ms": 0 }],
  "fix_causes": { "contract": 0, "spec": 0, "security": 0, "test": 0 },
  "lessons": [{ "role": "…", "text": "…" }], "warnings": [] }
```
- `top_spend` and `top_time`: the 3 largest ledger rows by `spend` and by `ms` (rows with `null` left out; ties by Step order). The numbers are the ledger's, unchanged.
- `fix_causes`: Blocking items counted per tag over every Step file of the run whose `role` is a review Role (`code-reviewer`, `qa`, `security`, `compliance`, `accessibility-tester`); each such item is a Fix-round cause by the pipeline's rule.
- `lessons` (0–3): for the tag with the highest count, `<tag> findings caused <n> Fix-round items; check the <tag> rules before review` (Role `lead`); then the step-check handover and lint rules for the Steps they apply to.

## Error cases
- Missing ledger → `top_spend: []`, `top_time: []`, `warnings: ["no ledger"]`.
- A Step file that cannot be read → left out, `warnings: ["<file> skipped"]`.
- Always exit 0 for a valid `<slug>`.
