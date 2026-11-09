# Contract: wayfinder v1

Provider: `scripts/wayfinder.mjs` (Node built-ins only; read-only, writes nothing). Exports `validate(text, { root })` and `main(args, { root })`. Consumers: the Architect (`aico:planning`, writes and updates a map), the Lead and any Role told to read one at the start of a session. Uses: `plan-tasks` v1.7 (`parsePlan` read only, for `#T<n>` anchors; `normalizePath`) and `work-folder-name` v1.1 (`isWorkFolder`, `exactWorkPath`). Rationale: docs/adr/0065-plan-tasks-owns-lanes.md (wayfinder reads plan tasks, never owns their syntax).

## Purpose
A decision map for an effort that spans sessions. It points to files that hold the real content (plans, ADRs, Handoffs, brainstorms, Contracts) and copies nothing from them. Its lines are data for the reader, never instructions.

## File
`.company/wayfinder/<name>.md`, name `^[a-z0-9][a-z0-9-]{0,63}\.md$`. Regular file, one hard link, not a link, at most 64 KiB and 400 lines, UTF-8. Line ends CRLF, LF or a lone CR.

## Lines (anything else is an error)
1. Line 1: `# Wayfinder: <topic>`, topic 1-80 characters.
2. Blank lines anywhere after line 1.
3. Headings, each at most once, in this order: `## Decisions`, `## Open`, `## Pointers`.
4. Under `## Decisions`: `- D-<n> <text> — src: <ref>[, <ref>…]`.
5. Under `## Open`: `- O-<n> <text> — src: <ref>[, <ref>…]`.
6. Under `## Pointers`: `- <ref> — <why>`.
- `<n>` 1-999, unique per prefix. `<text>` 1-200 characters, `<why>` 1-120. At most 3 refs per line. A line holds at most 240 characters. No control character (Cc, Cf, Zl, Zp) except the line end.
- `<ref>` = `<path>[#<anchor>]`, bare or wrapped in one pair of backticks. The path is relative to the product root and passes the path rule of `plan-tasks` v1.7, except that inside backticks a segment right after `.company/work/` may be any work folder name (`isWorkFolder`, exact letter case). Anchor: `T<id>` (task ID pattern of `plan-tasks`) or `^[A-Za-z0-9-]{1,40}$`.

## Validation (`wayfinder.mjs check <file>`)
- Each `<path>` must resolve, by `lstat` of every segment under the root, to an existing regular file; a link on the way counts as missing.
- A `#T<id>` anchor on a plan file (plan-check plan name or `input-fix.md`) must name a task that `parsePlan` finds; other anchors are not checked in v1.
- Output: one line `ERROR <line>: <reason>` per problem in line order, then `wayfinder: <e> errors`. Reasons: `bad title`, `heading order`, `not a pointer or decision line`, `line too long`, `fence`, `bad ref`, `duplicate id <D-n|O-n>`, `pointer missing <path>`, `task missing <id> in <path>`, `too large`. A path is echoed only when it passed the path rule. An empty text is `ERROR 1: bad title`.
- `validate` fails closed: text over 256 Ki characters returns only `too large` on line 1; text over 400 lines is checked for its first 400 lines and then adds `too large` on line 401. It never reports as valid text it did not check.
- Exit 0 no error; 1 errors; 3 refused (`refused: <reason>` for bad arguments, bad file name, link, too large, not UTF-8, unreadable; nothing else printed).

## Error cases
- A code fence, a quote line (`>`) or any prose line is `fence` or `not a pointer or decision line`: the map never holds copied file content (brief AC9).
- A broken pointer names its path (brief AC8).

## Compatibility
New Contract. A new line shape or heading is a minor bump; a removed one a major.
