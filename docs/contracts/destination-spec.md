# Contract: destination-spec v1

Provider: `scripts/spec-check.mjs` (Node built-ins only). Writer of the spec: the Product Manager, at step 5a of a feature run. Consumers: the Lead of `aico:feature` (`check`, `stamp`), the Ship Gate (the check line) and, for a client project, the `aico:client handoff` package. Rationale: `docs/adr/0044-destination-spec-without-paths.md`.
A feature run leaves one short spec of the destination. It holds no file path and no code, so it cannot go stale when files move. Plans keep their `files:` paths; only the spec is checked. Feature runs only: fix, maintain and other Playbooks write no spec.

## Where it lives
- `docs/specs/<slug>.md` in the product repo (slug `^[a-z0-9][a-z0-9-]{0,63}$`).
- A client project whose `.company/project.md` has `spec_in_repo: no` keeps it at `.company/work/<slug>/spec.md`; it goes only into the `aico:client handoff` package. The client decides at intake. A client project with no `spec_in_repo:` line: the Lead asks the CEO before step 5a (recommended `no` until the client says yes).
- No other path is accepted by either command.

## Shape
```markdown
---
slug: <slug>
version: <x.y.z | pending>
shipped: <YYYY-MM-DD | pending>
---
## Problem
## Solution
## User stories
## Decisions
## Testing decisions
## Out of scope
```
The frontmatter is exactly `slug`, `version`, `shipped`, in that order. The six headings appear exactly as written, once each, in that order. The Product Manager writes `version: pending` and `shipped: pending`; the Lead stamps them after the Ship Gate approval and commits the spec with the ship.

## `check <file>`
Reads the file by the real-path read rule: the real path of the lexical path equals it (case-insensitive on win32 and darwin), so no link or junction lies on it; it lies inside the real product root; its canonical form is a spec path above; `lstat` shows a regular file with one hard link; the opened handle has the same device and inode. There is no fallback to the lexical path. At most 64 KiB (checked before parsing), UTF-8. A path outside the two allowed forms, a link, a hard-linked file, a missing file, a file over the cap or invalid UTF-8, a control character or an argument over 4096 characters → `refused: <reason>`, exit 3, nothing read further.

Output: one `ERROR line <n>: <reason>` per problem (at most 50 shown; fixed words only, no spec text), then `spec-check: <e> errors`. Exit 2 when e > 0, else 0. Reasons:
- `bad frontmatter`: the five lines above are not exactly as shown, `version` is neither `pending` nor `^\d+\.\d+\.\d+$`, or `shipped` is neither `pending` nor a calendar date.
- `missing heading <h>`; `heading out of order <h>`.
- `code block`: a line that starts, after up to 3 spaces, with 3 or more backticks or tildes.
- `file path in spec`: any token of a line after the frontmatter that passes the path test.

Path test. Per line: URLs `<scheme>://…` (up to the next whitespace) are removed first; the rest is split on whitespace and ``()[]{}<>"'`,;`` (so inline code span contents are tested); a token loses leading `*` `_` and trailing `. : ! ? * _`, then a `#` and everything after it, then a trailing `:<n>` or `:<n>-<n>` line reference (so `scripts/x.mjs:120` and `x.mjs#L40` are read as `scripts/x.mjs` and `x.mjs`). A token is a path when: (a) it holds `/` or `\` and its last segment ends `.<ext>`; (b) it starts with `./`, `../`, `~/`, `<letter>:\`, or with `/` followed by at least one more character; (c) it is a bare name ending `.<ext>`. `<ext>` (case-insensitive) is one of `mjs cjs js jsx ts tsx json md mdx yml yaml toml ini py go rs java kt cs rb php sh ps1 bat html css scss sql lock xml gradle swift c h cpp`. So `scripts/x.mjs`, `check.mjs`, `./run`, `C:\x` and a backticked path are errors; `https://example.com/a.md`, `v1.2`, `and/or`, `TCP/IP`, `8.5` and a lone `/` are not. The scan is one pass over the line; the work grows linearly with the file size.

## `stamp <file> --version <x.y.z> --date <YYYY-MM-DD>`
The version matches `^\d+\.\d+\.\d+$` and the date is a calendar date; any other flag, a repeated flag or a missing value → `refused`, exit 3. The spec is read by the same rule as `check`, its frontmatter must have the shape above, and both `version` and `shipped` must be `pending`; if either is not → `refused: spec is already stamped`, exit 3, so a second stamp changes nothing. Only the two frontmatter lines change; every other byte stays.

Writing: a temp file with a random name (`.spec-<24 hex>.tmp`) in the spec's own folder, opened `O_CREAT|O_EXCL|O_WRONLY` (plus `O_NOFOLLOW` where it exists and the platform is not win32), written, `fsync`ed and closed. Right before the rename the folder and spec are checked again (same real path, regular file, one hard link, same device and inode); the temp file is renamed over the spec; `lstat` after shows a regular file with one hard link. On any failure the temp file is removed and the spec stays as it was. Prints `stamped <path> <version> <date>`, exit 0.

## Ship Gate
The Ship Gate shows the `check` result of the feature's spec (`spec-check: <e> errors`). An ERROR goes back to the Product Manager once; the Lead does not run a second round.
