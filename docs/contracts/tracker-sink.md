# Contract: tracker-sink v1

Status: draft until plan tasks T9 and T11 (run 2026-11-08 20.27 - Pocock Large Items) build the providers; T9 removes this line and backticks the local sink and suite paths, T11 the sync path.

Providers: scripts/tracker-sink-local.mjs (`createLocalSink(root)`, the only adapter in v1) and scripts/tracker-sync.mjs (the one driver, CLI `sync`). Test double and shared suite: scripts/tracker-sink-suite.mjs (`runSinkSuite`, `createFakeSink`), owned by QA. Uses: `plan-tasks` v1.8 (`parsePlan`, lane fields, `readParallel`), `afk-eligibility` v1. Rationale: docs/adr/0066-tracker-one-way.md. A GitHub issues adapter comes later on this same Contract.

## One way
The plan file is the source of truth. The sink only receives: nothing the sink holds is ever read into a plan, a Handoff, a dispatch or a label decision. An issue holds no body text and no personal data.

## Item (what `upsert` receives)
`{ marker, title, labels, link, hash }`, nothing else (`bad-item` otherwise):
- `marker`: `aico-task:<r>:<id>`, `<r>` = 12 lowercase hex of SHA-256 of the work folder name, `<id>` the task ID. Hidden on GitHub later; a plain field locally.
- `title`: `<id> <heading text after the ID>`, control characters removed, cut to 120 characters.
- `labels`: exactly two, `hitl` or `afk`, and `why:<code>` (`afk-eligibility` v1 code). The sink adds or keeps `stale` itself.
- `link`: the repo-relative plan path plus `#<id>` (work folder segment as written).
- `hash`: 12 lowercase hex of SHA-256 of the task's block bytes (heading line to the end of the block).

## Adapter operations
- `upsert(item) → { number, result }`. No issue with the marker → create it open: `created`. Same title, labels, link and hash, open → `unchanged`, nothing written. Hash differs → set title, labels, link and hash from the item, add `stale`, reopen if closed: `stale`. Only other fields differ (a hand edit) or the issue is closed → set them from the item, reopen: `updated`.
- `close(marker) → { result }`: `closed`, `already-closed` or `unknown`.
- `listMarkers(prefix) → [{ marker, number, state }]` for markers starting with `prefix`. Returns nothing else, ever.

## Driver `tracker-sync.mjs sync <slug> <plan> [--sink local]`
Builds one item per plan task. A task done in any round of `readParallel` is closed; every other task is upserted. Every marker of the run's prefix that names no plan task is closed. Prints one line per task in plan order, `<result> <id>`, then `tracker: <c> created, <u> updated, <s> stale, <n> unchanged, <x> closed`. Exit 0; 1 sink or plan unreadable, record broken; 3 refused (bad slug, plan name, letter case as `plan-tasks` v1.7, rule from v1.6). Never writes the plan or the record.

## Local adapter
File `.company/tracker/local-sink.json`: `{ "v": 1, "next": <n>, "issues": [{ "number", "marker", "title", "labels", "link", "hash", "state": "open" | "closed" }] }`. Read and written with `lstat` checks (no link, one hard link, at most 1 MiB, at most 2000 issues); written whole through a temp file and rename. A person may edit it; the next sync puts plan values back.

## Errors (`SinkError` with `code`)
`sink-unreadable`, `sink-version`, `marker-duplicate` (two issues share a marker: nothing is written), `sink-full`, `bad-item`.

## Compatibility
New Contract. A new operation or item field is a minor bump; a read of issue text is never added to v1.
