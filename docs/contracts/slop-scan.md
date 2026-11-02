# Contract: slop-scan v1

Provider: `scripts/slop-scan.mjs` (read-only; opens inputs for reading, writes nothing); catalog data `scripts/slop-catalog.mjs`. Imports: `node:fs`, `node:path`, `node:url`, the catalog, and `exactWorkPath` from `mods/lib/work-folder.mjs` (the one shared exact-spelling check for `.company/work/` paths). No network module, no `fetch`, no child process (a test checks the imports). Consumers: writing Roles, QA, the CEO, and the `voice-profile` Module (`walk`, `readInput`, `mask`, `countWords`, `paragraphs`, `wordTerms()`). Report only: the scan never fails a run because of tells.

## CLI
`slop-scan [--json] <path>...` (cwd = product root). `main(args, env)` exported by `scripts/slop-scan.mjs` takes `env.cwd` and `env.rules` (replaces the shipped `RULES`) and returns `{ code, stdout, stderr }`; the CLI writes those and sets the exit code.

A path is a `.md`, `.markdown` or `.txt` file, or a folder walked for those in code point order. Walk bounds: depth at most 6 below the named folder, at most 2000 files met per run (all named folders together), a file at most 1 MiB. Links, hard links and dot-named entries below a named folder are skipped silently; a path named directly may sit inside a dot-named folder. Each file is scanned once, however many named paths reach it (same real path).

## Checks per path
The lexical path is resolved under the real root; it is inside the root; `realpathSync.native` equals the lexical path; it is not a link (`lstat`), a file has `nlink` 1, the open handle has the same device and inode, and the size comes from the handle before reading. A path under `.company/work/` also passes `exactWorkPath`; a spelling that does not exist as typed is `missing`. Text is decoded as UTF-8 with a fatal decoder.

## Masking
Before matching, with line numbers kept: YAML frontmatter at line 1, fenced code, inline code spans, link targets (the text between `](` and the first `)` on the same line), HTML comments.

Malformed input: a construct with no close is not masked, so its text stays scanned and counted in `words`, and a broken file never gets a better figure. The file still counts as scanned, exit 0, no `ERROR`. That covers a fence with no closing fence (same character, at least the opening length, nothing else on the line), an inline span with no closing backtick run of the same length before a blank line, `<!--` with no `-->` in the file, and frontmatter at line 1 with no closing `---` line. The backticks of a fence line with no closing fence never open or close an inline span.

`words` counts whitespace-separated tokens holding a letter or digit, after masking.

## Units
Rules run on masked text. A paragraph is a run of consecutive lines joined with one space, each trimmed of space, tab, CR and leading `>` markers. A blank line, a fence or frontmatter, a bare `>` line or a change between quoted and unquoted ends it. A heading, a rule line (2 or more of one character from `-=*_`) and a table row (starts with `|`) are each their own paragraph. A list marker starts a new paragraph, and the plain lines after it join that item. A line holding only masked text stays inside its paragraph. So rewrapping a paragraph at single spaces changes only line numbers, never the tells, except for line-unit rules. Line-unit rules run on one masked line with its trailing space, tab and CR removed. Still a miss: a break inside a word or at a hyphen, a backslash hard break, two spaces inside a line, a term split by a heading, list, table or blank line.

## Output
Text: one line per tell, `<path>:<line> <rule-id> <label>`, `/` separators, sorted by path (code point order), line, rule id; last line `slop-scan: <t> tells, <w> words, <r> per 1000 words` with `r = (t*1000/w).toFixed(1)`, `0.0` when `w` is 0.

`--json`: `{ "v": 1, "files", "words", "tells": [{ "path", "line", "rule" }], "per_1000", "errors": [{ "path", "reason" }] }` in the same order; `per_1000` is the number `Number(r)`. Two runs on the same input are byte-equal. A path is shown relative to the root, and the root itself as `.`; control characters in it are shown as `?`, never raw.

## Exit codes
- 0: every input scanned, whatever the tell count (report only), an empty folder included.
- 1: at least one input not fully scanned. Each cause prints `ERROR <path>: <reason>` on stderr in both modes, sorted, and appears in `errors`; everything else is still scanned and the tell lines, summary or JSON still print.
- 2: bad usage (no path, unknown flag): one stderr line, nothing on stdout.

Reasons: `missing`; `unreadable`; `link` (a named link, hard link, or a path outside the root); `type` (a named file with another extension); `too large`; `not utf-8`; `limit` (the named folder went past depth 6, or the run past 2000 files; what was walked before the cut stays, reported under the named folder). A file met in a walk gets the same `too large`, `not utf-8` or `unreadable` as a named one, so a partial figure never looks whole.

## Catalog
Rule id `^[WS]\d{2}$`: W = word or phrase tell, S = structure tell; an id is never reused. `RULES` exported by `scripts/slop-catalog.mjs` holds `{ id, kind, label, unit, re }` or `{ id, kind, label, unit, test }`, exactly one of `re` and `test`, else `scan` throws `bad rule`. `re` is a global `RegExp`: each match is one tell, reported at the line where it starts. `test(text)` is a linear function returning a boolean: true is one tell per unit, reported at the unit's first line with text. `unit` is `paragraph` when absent, or `line`; S05, S06 and S09 are `line`. A W rule built by `wordRule` also holds `terms`. `wordTerms()` exported by `scripts/slop-catalog.mjs` returns the plain terms of the W rules.

## Cost bound
Masking and every matcher run in time linear in the input. A regex holds no quantified group with a quantifier inside and no unbounded lazy or greedy run across a line. One 1 MiB single-line adversarial text (backtick runs, repeated `<!--`, spaces, repeated catalog term prefixes) goes through `scan` in under 5 seconds. `paragraphs` runs once per file and every rule reuses its result. Three more 1 MiB texts go through `scan` in under 5 seconds: 60-character lines with no blank line (one paragraph), `- x` lines, and a single line of `>` characters.

## Exports
`scan(text, path, rules = RULES)` returns `{ path, words, tells }`; `main(args, env)`; `walk(root, env, state)` returns `{ files, errors, links }` (`links` counts every symlink and every hard-linked `.md`, `.markdown` or `.txt` file passed over); `paragraphs(text, masked)` returns `[{ text, starts, lines, first }]`; `readInput(path, env)`; `mask(text)`; `countWords(text)`. Catalog: `RULES`, `wordTerms()`. Tests: `scripts/slop-scan.test.mjs`; they inject their own rules, never the shipped `RULES`.
