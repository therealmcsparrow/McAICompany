# Contract: destination-spec v1.5

Provider: `scripts/spec-check.mjs` (Node built-ins only). Writer of the shipped spec: the Product Manager, at step 5a of a feature run; writer of a spec draft (v1.1): the Product Manager in an `aico:to-spec` run. Consumers: the Lead of `aico:feature` (`check`, `stamp`), the Ship Gate (the check line), for a client project the `aico:client handoff` package, and from v1.1 `aico:to-spec` (`check`) and `draft-input` (`checkText`, imported in-process, no child process). Rationale: `docs/adr/0044-destination-spec-without-paths.md`.
A feature run leaves one short spec of the destination. It holds no file path and no code, so it cannot go stale when files move. Plans keep their `files:` paths; only the spec is checked. Feature runs write the shipped spec; `aico:to-spec` writes only drafts; fix, maintain and other Playbooks write no spec.
v1.1 (task grill-spec-tickets, T1; additive): spec drafts from `aico:to-spec` at `.company/work/<slug>/spec.md`, the stamp and package scope, the `checkText` export and the grill trace in `## Decisions`. The shape, `check`, `stamp`, their output and their refusals are unchanged, so every v1 spec and every v1 caller stays valid.
v1.2 (task T11, minor): `<slug>` in a spec path and in the frontmatter `slug` is a work folder name, as `work-folder-name` v1 defines it: a new name (`YYYY-MM-DD HH.MM - <Topic>`, with an optional ` <n>` or `Draft` helper form, spaces inside) or a legacy slug. The old pattern is the legacy case. The check is the shared `isWorkFolder`, so a spec of a new run is accepted, a name the contract refuses (a `Build` helper with a number, lower-case words, a trailing space or dot, a bad date, a control character) is `refused`. The shape, `check`, `stamp`, output lines and exit codes are unchanged; every v1.1 spec and caller stays valid. `docs/specs/<name>.md` holds spaces and is committed, so a git call names it as one argument after `--literal-pathspecs` and `--`.

v1.3 (minor, additive): a spec path `.company/work/<name>/spec.md` typed with a folder or file in another letter case than on disk, or with `.company` or `work` in another letter case → `refused: wrong letter case`, exit 3, on every platform, nothing read or written (`exactWorkPath`, `work-folder-name` v1.1). The real-path compare of `check` and `stamp` is exact now, not case-insensitive on win32 and darwin. A missing spec keeps its old refusal. No new command, output line or exit code.

v1.4 (task T37, minor, additive; work-folder-name v3.0): `check` and `stamp` take `.company/work/<ProjectID>/<NN>-<playbook>/spec.md` and a frontmatter `slug:` that is the v3 run slug; `docs/specs/<name>.md` has no v3 form. A `<slug>` argument is accepted with `isRunSlug`; its folder is `exactWorkPath(io, root, workParts(slug))`, so a v3 run `<ProjectID>/<NN>-<playbook>` is read like a v2 folder. The v2, v1.1 and legacy names give byte-identical output to v1.3. `isWorkFolder` keeps its v2 meaning.

v1.5 (minor, additive): a v3 run gets a committed spec path `docs/specs/<ProjectID>~<NN>-<playbook>.md`, the flat run key (`runKey` of the run slug, `/` replaced by `~`). `check` and `stamp` judge the `<name>` of `docs/specs/<name>.md` with `slugOfKey` as well as `workParts(name)?.length === 1`, so a work folder name passes as before and a v3 key passes when its slug passes `parseRun`. The frontmatter `slug:` stays the run slug with `/`, checked with `isRunSlug`; it is not compared with the file name, as for every other form. Every v1.4 path, refusal line and exit code is byte-identical; no new command, output line or exit code. `draft-input` v1.8 takes this path too (`take`, `arg`), so a v3 run's shipped spec is an `aico:to-spec` input like any other.

## Where it lives
- `docs/specs/<slug>.md` in the product repo (`<slug>` a work folder name: a legacy slug `^[a-z0-9][a-z0-9-]{0,63}$` or a new name; spaces are allowed only in a new name). (v1.5) A v3 run `<ProjectID>/<NN>-<playbook>` writes `docs/specs/<ProjectID>~<NN>-<playbook>.md`; `docs/specs/` never holds a subfolder.
- A client project whose `.company/project.md` has `spec_in_repo: no` keeps it at `.company/work/<slug>/spec.md`; it goes only into the `aico:client handoff` package. The client decides at intake. A client project with no `spec_in_repo:` line: the Lead asks the CEO before step 5a (recommended `no` until the client says yes).
- (v1.1) A spec draft from `aico:to-spec` (own or client product) lives at `.company/work/<slug>/spec.md`, with `version: pending` and `shipped: pending`. It is never committed and never stamped. It is an input to `aico:feature`, whose step 5a writes the shipped spec.
- No other path is accepted by either command. The folder `.company/work/` and the prefix `docs/specs/` are matched in exactly that case.

## Stamp and package scope (v1.1)
- `stamp` runs only on the spec a feature run wrote at its own step 5a, under that run's task slug (`docs/specs/<run slug>.md`, for a v3 run `docs/specs/<run key>.md` (v1.5), or `.company/work/<run slug>/spec.md`). A spec named by a draft, a Handoff or a request is never stamped on that claim.
- The `aico:client handoff` package takes only stamped specs (`version` not `pending`) of feature runs. A `pending` spec is a draft: it is never packaged and never stamped.
- A feature run started from a draft never writes into the draft's folder: `draft-input` v1 `take --for feature` picks a run slug whose folder did not exist.

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

Decisions trace (v1.1): a draft built from a grill ends each `## Decisions` item with `(grill Q-<n>)` or `(grill F-<n>)` (the `grill-file` v1 entry id), never the grill file's name, since a file name fails the path test.

## `check <file>`
Reads the file by the real-path read rule: the real path of the lexical path equals it (exact, v1.3), so no link or junction lies on it; it lies inside the real product root; its canonical form is a spec path above; `lstat` shows a regular file with one hard link; the opened handle has the same device and inode. There is no fallback to the lexical path. At most 64 KiB (checked before parsing), UTF-8. A path outside the two allowed forms, a link, a hard-linked file, a missing file, a file over the cap or invalid UTF-8, a control character or an argument over 4096 characters → `refused: <reason>`, exit 3, nothing read further.

Output: one `ERROR line <n>: <reason>` per problem (at most 50 shown; fixed words only, no spec text), then `spec-check: <e> errors`. Exit 2 when e > 0, else 0. Reasons:
- `bad frontmatter`: the five lines above are not exactly as shown, `version` is neither `pending` nor `^\d+\.\d+\.\d+$`, or `shipped` is neither `pending` nor a calendar date.
- `missing heading <h>`; `heading out of order <h>`.
- `code block`: a line that starts, after up to 3 spaces, with 3 or more backticks or tildes.
- `file path in spec`: any token of a line after the frontmatter that passes the path test.

Path test. Per line: URLs `<scheme>://…` (up to the next whitespace) are removed first; the rest is split on whitespace and ``()[]{}<>"'`,;`` (so inline code span contents are tested); a token loses leading `*` `_` and trailing `. : ! ? * _`, then a `#` and everything after it, then a trailing location suffix made only of digits, `L`, `-` and `:` that starts at a `:` and holds a digit (`:<n>`, `:<n>-<n>`, `:<n>:<col>`, `:L<n>`, `:L<n>-L<n>`), so `scripts/x.mjs:120`, `scripts/x.mjs:12:5`, `x.mjs:L40` and `x.mjs#L40` are read as `scripts/x.mjs` and `x.mjs`. A token is a path when: (a) it holds `/` or `\` and its last segment ends `.<ext>`; (b) it starts with `./`, `../`, `~/`, `<letter>:\`, or with `/` followed by at least one more character; (c) it is a bare name ending `.<ext>`. `<ext>` (case-insensitive) is one of `mjs cjs js jsx ts tsx json md mdx yml yaml toml ini py go rs java kt cs rb php sh ps1 bat html css scss sql lock xml gradle swift c h cpp`. So `scripts/x.mjs`, `check.mjs`, `./run`, `C:\x` and a backticked path are errors; `https://example.com/a.md`, `v1.2`, `and/or`, `TCP/IP`, `8.5` and a lone `/` are not. The scan is one pass over the line; the work grows linearly with the file size.

## `checkText` (v1.1)
`checkText(text)` exported by `scripts/spec-check.mjs`: takes the decoded spec text and returns `[[line, reason], …]`, the same reasons in the same order as `check` (all of them, not cut to 50). It does no I/O and never prints. The caller applies the 64 KiB cap before it calls `checkText`. Importing the module runs no command: the CLI runs only when the file is the started script.

## `stamp <file> --version <x.y.z> --date <YYYY-MM-DD>`
The version matches `^\d+\.\d+\.\d+$` and the date is a calendar date; any other flag, a repeated flag or a missing value → `refused`, exit 3. The spec is read by the same rule as `check`, its frontmatter must have the shape above, and both `version` and `shipped` must be `pending`; if either is not → `refused: spec is already stamped`, exit 3, so a second stamp changes nothing. Only the two frontmatter lines change; every other byte stays.

Writing: a temp file with a random name (`.spec-<24 hex>.tmp`) in the spec's own folder, opened `O_CREAT|O_EXCL|O_WRONLY` (plus `O_NOFOLLOW` where it exists and the platform is not win32), written, `fsync`ed and closed. Right before the rename the folder and spec are checked again (same real path, regular file, one hard link, same device and inode); the temp file is renamed over the spec; `lstat` after shows a regular file with one hard link. On any failure the temp file is removed and the spec stays as it was. Prints `stamped <path> <version> <date>`, exit 0.

## Ship Gate
The Ship Gate shows the `check` result of the feature's spec (`spec-check: <e> errors`). An ERROR goes back to the Product Manager once; the Lead does not run a second round.
