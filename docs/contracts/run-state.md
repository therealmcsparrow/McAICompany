# Contract: run-state v1

Provider: `scripts/run-state.mjs` (Node built-ins only). Writer: the Lead (`aico:pipeline`, through `skills/pipeline/references/run-state.md`). Consumers: the `aico-mods` v1 mods (Savvy, Reflect, Blast Radius, Cache Tax), through `show` and `active` only.
Why it exists: Handoff frontmatter gives Steps, Roles, status and Fix round, but nothing on disk says which wave a run is in, which Gates passed, when it started or how it ended (`docs/adr/0016-run-state-record.md`).

## Storage
- `.company/work/<slug>/run-state.jsonl`, append-only, one JSON object per line, LF. `<slug>` matches `^[a-z0-9][a-z0-9-]{0,63}$`.
- Counts, enums and times only. No prompt, reply, Handoff or CEO text (GDPR Art. 5(1)(c)).
- Limits: a line ≤ 256 bytes, a file ≤ 64 KiB, at most 1000 lines. The file and the run folder are opened with `lstat`; a symlink is refused.
- Committed with the run's Handoffs (it sits in the run folder).

## Record (allow-list; unknown keys refused)
| Key | Value |
|---|---|
| `v` | `1` |
| `at` | UTC time `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script, never typed by the Lead |
| `ev` | `start \| wave \| gate \| end` |
| `wave` | `wave` only: integer 1–99 (the plan's wave number; a Fix round keeps the wave it belongs to) |
| `gate` | `gate` only: `brief \| plan \| ship` |
| `result` | `gate` only: `passed \| changed \| stopped` |
| `outcome` | `end` only: `ship \| abort` |

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2)
| Command | Effect |
|---|---|
| `start <slug>` | appends `start`. Refused when the file already has a `start` and no `end` (`refused: run <slug> already started`). A new `start` after an `end` begins a new segment (a resumed or reopened run). |
| `wave <slug> <n>` | appends `wave`. Refused without an open segment. |
| `gate <slug> <brief\|plan\|ship> <passed\|changed\|stopped>` | appends `gate`. Refused without an open segment. |
| `end <slug> <ship\|abort>` | appends `end`, closing the segment. Refused without an open segment. |
| `show <slug> --json` | prints the run view (below), exit 0 even for a missing or damaged file |
| `active --json` | prints `{ "slug": <slug or null>, "view": <run view or null> }` for the active run, exit 0 |

Writes are append with `O_APPEND`; the script checks the size limit before writing.

## Run view (`show`, `active`)
```json
{ "v": 1, "slug": "x", "state": "running|ended|stale|none", "started": "<at>", "ended": "<at>|null",
  "outcome": "ship|abort|null", "wave": 2, "gates": [{ "gate": "brief", "result": "passed", "at": "<at>" }],
  "round": 1, "tier": "low|medium|high|unknown",
  "steps": [{ "step": "05", "role": "backend-engineer", "status": "done", "round": 0, "file": "05-backend-engineer.md", "mtime": "<at>" }],
  "warnings": ["line 7 skipped"] }
```
- `steps`: every `^\d{2}-[a-z0-9-]+\.md$` file in the run folder (no recursion, at most 200, each read only to the end of its frontmatter and at most 8 KiB, frontmatter parsed with the `handoff-lint.mjs` parser). Files without a valid `step` and `role` are left out with a warning. `status`, `round` and `risk-tier` outside their allowed values read as `unknown`.
- `round` = highest `round:` among `steps`; `tier` = highest `risk-tier:` among `steps` (`low < medium < high`), else `unknown`.
- Times and order come from the file; the view uses only the last segment (from the last `start`).

## Active run
`active` picks, among `.company/work/*/run-state.jsonl` (at most 200 folders), the one whose last segment has no `end` and whose newest activity (last record, or newest Step file mtime) is the most recent. A segment with no activity for 12 hours is `stale` and never active. No candidate → `{ "slug": null, "view": null }`.

## How the pipeline uses it (`aico:pipeline`, Core)
- Setup, once the slug is known: `start <slug>`.
- Each wave start in the plan: `wave <slug> <n>`.
- Each Brief, Plan and Ship Gate answer (an `auto` Gate counts as `passed`): `gate <slug> <gate> <result>`.
- Ship done, or the CEO stops the run: `end <slug> ship|abort`.
- A run resumed with "resume <slug>" after an `end` runs `start <slug>` again.
- The Lead never edits the file by hand; a refused command is reported in the next Gate summary and the run goes on (run-state never blocks a Step or a Gate).

## Error cases
- Missing file → `state: none`, empty `gates`, `steps` still listed.
- Bad line (invalid JSON, unknown key, over 256 bytes, CR byte) → skipped, `warnings: ["line <n> skipped"]`.
- File over 64 KiB or a symlink → `state: none`, `warnings: ["run-state unreadable"]`; writes refused.
- Bad `<slug>`, unknown gate, result or outcome, `wave` outside 1–99 → `refused`, nothing written.
