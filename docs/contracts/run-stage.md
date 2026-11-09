# Contract: run-stage v1.1

Provider: `scripts/run-stage.mjs` (Node built-ins only). Writer: the Lead (`aico:pipeline`), one `set` each time a run enters a new stage. Consumers: `scripts/dashboard-data.mjs` (`dashboard` v1, `board` and `refreshActive`), through `readStage` only.
Why it exists: run-state v1.8 records waves and Gates but not where a run stands between them (a build wave and a review round look the same), so the dashboard cannot place a card in a column from records alone. Rationale: `docs/adr/0057-dashboard-reads-script-json-only.md`. Report only; a stage never blocks a Step or a Gate. v1.1 is additive (T33; `work-folder-name` v3.0 `isRunSlug`, `workParts`): `<slug>` may be a v3 run slug `<ProjectID>/<NN>-<playbook>`; the stage file is `.company/work/<ID>/<NN>-<pb>/stage.jsonl`, found with `exactWorkPath(io, root, workParts(slug))`, and both folders must be real directories (no link) inside the real `.company/work`. A slug with a second `/`, `..`, `\` or a bare project ID is `bad slug`. v2, v1.1 and legacy names give byte-identical output to v1.

## Storage
- `.company/work/<slug>/stage.jsonl`, append-only, one JSON object per line, LF. Committed with the run's Handoffs (it sits in the run folder).
- `<slug>` is a work folder name checked with `isWorkFolder` and `exactWorkPath` of `mods/lib/work-folder.mjs` (`work-folder-name` v1.1): a bad shape is `bad slug`, a spelling that matches a folder only in another letter case is `wrong letter case`. The run folder is used only when `lstat` says it is a directory and its real path is the folder of that name inside the real `.company/work`.
- Limits: a line ≤ 128 bytes, a file ≤ 16 KiB, at most 200 lines. The file is opened with `lstat`; a symlink, or anything but a regular file, is refused. Writes use `O_APPEND` (and `O_NOFOLLOW` where the platform has it); the script checks the limits before writing.
- An enum and a time only. No prompt, reply, Handoff or CEO text (GDPR Art. 5(1)(c)).

## Record (allow-list; unknown keys refused)
- `v`: `1`.
- `at`: UTC time `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script, never typed by the Lead.
- `stage`: `brief | plan | build | review | ship-gate`.

Example line: `{"v":1,"at":"2026-11-04T01:19:00Z","stage":"build"}`.

## CLI (cwd = product repo)
- `set <slug> <stage>`: appends one record with the current time. Refusals print `refused: <reason>` on stdout, exit 2, nothing written: `bad slug`, `wrong letter case`, `unknown stage`, `no run folder` (the folder is missing, a link, or its real path is outside the real `.company/work`), `stage file unreadable` (a link or not a regular file), `stage file full` (the line would pass a limit). The slug is never echoed in a refusal.
- `show <slug> --json`: prints `{ "v": 1, "slug": "<slug>", "stage": "<stage>"|null, "at": "<at>"|null, "state": "recorded|none|unreadable" }`, exit 0 always. A bad or wrong-case slug prints `"slug": null` and `state: none`; the slug is not echoed.
- `readStage(root, slug)` exported by `scripts/run-stage.mjs` returns the same object as `show <slug> --json`.

## Reading
- `stage` and `at` come from the last line of the file only; earlier lines are history and are not checked again.
- `state: recorded` when the last line is a valid record.

## Error cases
- Missing file, or an empty file → `state: none`, `stage` and `at` `null`.
- Last line unparsable, `v` other than 1, an unknown key or an unknown stage → `state: unreadable`, `stage` and `at` `null`. Only that run is affected.
- File a link, not a regular file, over 16 KiB or over 200 lines when read → `state: unreadable`.
- Run folder missing or outside the real `.company/work` → `state: none`.
