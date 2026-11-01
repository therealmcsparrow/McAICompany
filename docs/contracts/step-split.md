# Contract: step-split v1

New Contract (task context-cap-enforcement T3). Provider: `scripts/step-split.mjs` (Node built-ins only; `main(argv, { root, exec })` exported). Consumer: `aico:pipeline` (review and Fix rounds that would not fit one Step's context), the Code Reviewer lanes and builders via the `Review group:` and `Fix group:` lines of `dispatch-prompt` v4.4. Uses `review-depth` v1.3 (`--lines`) and `work-folder-name` v1 (`exactWorkPath`).
A group is a list of paths or Blocking rows small enough for one Step to judge inside the handover point. The script never runs git itself and never writes outside the `split/` folder of the run.

## Commands
Exit 0 printed, 2 refused (`refused: <reason>` on stdout, nothing written). `<run>` is a work folder name (`work-folder-name` v1) whose spelling is checked against the folder entries (`exactWorkPath`); the run folder and `split/` must be plain folders (no links). `<round>` is `^(0|[1-9][0-9]{0,2})$`. Group files are LF only, one entry per line, numbered from 1 (`g1.txt`, `g2.txt`, ...).

### `review '<run>' <base> <round> [--max-lines <n>] [--max-files <n>]`
- `<base>` is a full object id (40 or 64 hex). `--max-lines` (default 1200) and `--max-files` (default 25) are whole numbers `^[1-9][0-9]{0,6}$`, each given at most once.
- Runs `review-depth.mjs` by `execFile` (no shell) with exactly the argv `[process.execPath, <scripts dir>/review-depth.mjs, <base>, '--run', <run>, '--json', '--lines']`. It never passes `--risk`: the risk tier adds a `*` reason but does not change the path list, so a high-tier run still splits.
- Refuses with `refused: no full path list (<cause>)` and writes nothing when review-depth fails or prints something else than the `--json` shape, the JSON has `truncated: true` (cause `truncated`), `paths: []` (cause `paths: []`), or any `*` reason other than `core unknown at base` (causes such as `grafts file present`, `head not on run branch`, `diff unavailable`, `no run ref`). The Lead then dispatches one unsplit review. A path with a line break, or a `lines` that is not a non-negative integer, is refused the same way.
- `core unknown at base` with a full list is split: every path has `module: null`, so areas come from the segment rule.
- Area = the path's `module`, else its first two path segments. Areas in name order (code units) are packed greedily into groups of at most `--max-lines` changed lines and `--max-files` files. An area over a limit is split by file (name order). One file over `--max-lines` is its own group; its reviewer uses the handover chain (`status: handover`) when it nears the handover point.
- Writes `split/r<round>/g<i>.txt`. Prints `groups: <n>`, then per group `group <i>: <lines> lines, <files> files: <areas>` and, indented on the next line, the file path relative to the project root.

### `fix '<run>' <round> <handoff>...`
- Each `<handoff>` is a file name `^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}\.md$` in the run folder, given bare or as `.company/work/<run>/<name>`; at most 50, each a plain file (no symlink, no hard link: link count 1) up to 1 MiB, checked again on the open handle.
- Reads only `## Blocking` bullet lines (`- ...`; `- none` is ignored).  A path in a row is only an area key: it is never opened or joined to a path; only its first 324 characters are searched. A row matches `^- \[(contract|spec|security|test|comprehension)\] (?:[RT]-\d{1,4} )?<path>`: `<path>` is 1-300 characters, starts with a non-space, may hold spaces, and ends at the first `:<digits>` (those digits are `<line>`) or the first ` — `, whichever comes first; neither found means not a row. Key = `<tag> <path>[:<line>]`; the same key from two Handoffs is one row (the first kept).
- `comprehension` rows are plan-text fixes: they go to `split/f<round>/architect.txt` (lines `<handoff>:<line no>`), never into a builder group. Other rows are placed by the area rule of their path (first two segments). Bullets that do not match form the area `unplaced`, packed on their own: never added to another group.
- Groups hold at most 8 rows; an area over 8 splits in name order. Writes `split/f<round>/g<i>.txt` (lines `<handoff>:<line no>`; `<line no>` is the 1-based line of the Handoff). No row at all is `refused: no blocking rows`.
- Prints `groups: <n>`, per group `group <i>: <rows> blockers: <areas>` and its path, then `architect: <n> rows` and its path when n > 0.

### `show '<run>' <r|f><round>`
Read-only. Prints the existing folder: `groups: <n>`, per group `group <i>: <entries> entries` and its path, and for `f` `architect: <n> rows` with its path. No folder prints `groups: 0`. Lead action on `split exists` (compaction or a crash between the split and the dispatch): run `show` and dispatch every group whose done Handoff the Lead cannot point to; a duplicate review is safe because `fix` merges equal keys.

## Crash safety
Each `review` and `fix` writes its files into `split/.tmp-<kind><round>-<pid>/` and, as its last act, renames that folder to `split/<kind><round>/` (`kind` is `r` or `f`), so a crash never leaves a partial set. The target folder existing, in any form, is `refused: split exists`; the folder is not touched. `.tmp-*` folders are never read and are not cleaned up except for the same name being reused.
