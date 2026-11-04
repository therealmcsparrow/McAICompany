# Contract: intake-record v1

Provider: `scripts/intake.mjs` (Node built-ins only). Writers: `aico:lead` and `aico:triage` (the front door): `add` at triage, `set` when a run folder is made for the request or it is held or declined. Consumers: `scripts/dashboard-data.mjs` (`dashboard` v1, the intake lane), through `listIntake` only.
Why it exists: a request that is held for more information or declined never gets a run folder, so nothing on disk shows it. The dashboard's intake lane needs that outcome. Rationale: `docs/adr/0057-dashboard-reads-script-json-only.md`. Report only; a record never blocks a Step or a Gate.

## Storage
- `.company/intake/intake.jsonl`, one JSON object per line, LF; append-only between prunes (Retention).
- Limits: a line ≤ 256 bytes, the file ≤ 64 KiB, at most 1000 lines.
- Plain files only: `.company` and `.company/intake` must be plain folders by `lstat` (a link is refused, `intake folder is a link`); `intake.jsonl` and `.gitignore` must be regular files with one hard link. Writes use `O_APPEND` (and `O_NOFOLLOW` where the platform has it).
- Never committed: every write first makes `.company/intake` when missing and writes `.gitignore` = exactly `*` and LF when it is missing or differs.

## Record (allow-list; unknown keys refused)
- `v`: `1`.
- `at`: UTC time `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script.
- `id`: exactly 12 lowercase hex (6 bytes of `crypto.randomBytes`), made by `add`.
- `outcome`: `intake | needs-info | rejected` (`intake`: taken in, a run folder follows or exists; `needs-info`: held until the CEO adds information; `rejected`: declined).
- `topic`: the Topic grammar of `work-folder-name` v1.1 (`checkTopic`), at most 60 characters.
- `slug`: optional; a work folder name that passes `isWorkFolder` (`work-folder-name` v1.1).

## Data rule (GDPR Art. 5(1)(c))
- The Topic names the subject of the request (a feature, a bug area, a product part), never a person, client or company. `checkTopic` accepts person names, so this rule is enforced by the `aico:lead` and `aico:triage` text, not by the script.
- No other CEO text is stored: no request body, no reply, no reason.

## Retention (GDPR Art. 5(1)(e))
Before each `add` and `set` appends, every id whose latest record `at` is more than 90 days before now is dropped, with all its records, together with every bad line. The rest is written to a temporary file in `.company/intake/` and renamed over `intake.jsonl`. Still at a limit after that → refused `intake full`.

## Id
- Printed once by `add`, kept only in `intake.jsonl` and in the Lead's own session context.
- Never written to a Handoff, run folder, dispatch or other file.
- A later session finds a held request with `list --json`: the `needs-info` item whose `topic` equals the new request's Topic exactly. No match → a new `add`.

## CLI (cwd = product repo; refusals `refused: <reason>` on stdout, exit 2, nothing written)
- `add <outcome> '<topic>' [<slug>]`: appends a record with a new id; prints `id: <id>`, exit 0.
- `set <id> <outcome> [<slug>]`: appends a later outcome for the same id; refused `unknown id` when no record has that id (after the prune).
- `list --json`: prints `{ "v": 1, "items": [{ "id", "outcome", "topic", "slug": "<slug>"|null, "at" }], "warnings": [] }`: the latest record per id, newest `at` first, at most 200, exit 0 always. Reads only; ids whose latest record is older than 90 days are left out.
- `listIntake(root, { now })` exported by `scripts/intake.mjs` returns the same object as `list --json`.
- Refusal reasons: `bad outcome`, `bad topic`, `bad slug`, `bad id`, `unknown id`, `intake full`, `intake folder is a link`, `intake file unreadable`. The Topic is never echoed in any output.

## Error cases
- Missing file → `items: []`.
- A bad line (invalid JSON, unknown key, a value outside its rule, over 256 bytes, CR byte) → skipped, `warnings: ["line <n> skipped"]`.
- File a link, more than one hard link, or over 64 KiB when read → `list` gives `items: []` and `warnings: ["intake unreadable"]`; `add` and `set` are refused `intake file unreadable`.
