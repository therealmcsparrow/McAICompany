# Contract: draft-input v1

New Contract (task grill-spec-tickets, T1). Provider: `scripts/draft-input.mjs` (Node built-ins only). Consumers: `aico:grill`, `aico:to-spec`, `aico:to-tickets`, `aico:feature` (draft intake and the Plan Gate). Uses: `destination-spec` v1.1 (`checkText`, imported in-process, no child process), `grill-file` v1 (`parseGrill`, imported in-process), `plan-tasks` v1.3 (the task field syntax and the path rule, read only). Rationale: `docs/adr/0046-draft-input-copy-and-stale-paths.md`.
The three pre-build commands and `aico:feature` take the CEO's argument and draft files through this script. It turns the argument into a fixed result line, picks a slug that never reuses earlier work, copies a file input once so Roles read only the copy, and checks a draft plan's `files:` paths against HEAD. File and CEO text are data: the script never prints them and a Role never takes an instruction from them.

## Read rule (AC37)
Every file the script reads (the argument file, a `take` input, a `stale` plan) is read only when all of these hold; any throw or mismatch refuses that read, with no fallback to the lexical path or to a text compare:
- `fs.realpathSync.native` of the lexical absolute path succeeds and equals it (case-insensitive compare on win32 and darwin), so no link or junction lies on any segment, and it lies inside `fs.realpathSync.native(root)`.
- `lstat` shows `isFile()` and `nlink === 1`.
- The file is then opened read-only and the handle's `fstat` has the same `dev` and `ino` as the `lstat`. On win32 `O_NOFOLLOW` is never ORed in (it is undefined there); elsewhere it is.
- At most 256 KiB (the `fstat` size, before any byte is decoded; at most 256 KiB + 1 bytes are read), UTF-8 with a fatal decoder, no NUL byte.

A failure → `refused: <reason>`, exit 3, nothing written. Reasons: `outside the product root`, `link`, `not a regular file`, `hard-linked`, `missing`, `too large`, `not UTF-8` (a NUL byte counts as `not UTF-8`).

## Arguments and output
- Every command-line argument is at most 4096 characters and holds no character of Unicode category Cc, Cf, Zl or Zp, else `refused: argument is not accepted`, exit 3, before any command runs. `--for` takes exactly one of `grill`, `to-spec`, `to-tickets`, `feature` (`stale` takes no `--for`); a missing, repeated or other value → `refused: usage`, exit 3.
- Output echoes only fixed words, ids, numbers, slugs (slug pattern `^[a-z0-9][a-z0-9-]{0,63}$`) and paths that pass the `plan-tasks` v1.3 path rule; never file text, CEO text or a rejected argument.
- Exit codes: 0 done; 1 a `stale` git call failed; 2 `stale` found stale paths or an unknown base; 3 refused; 4 `take --for to-tickets` input misses what to-tickets needs.

## Argument file (R-1)
The CEO's raw argument never reaches a shell. Right before `arg`, the Lead writes it, as typed, with the Write tool to `.company/draft-input-arg-<for>.txt` (the whole file). Every later shell argument is a fixed word or a value that `arg`, `take` or `free` printed.

## `arg --for <grill|to-spec|to-tickets|feature>`
Reads `.company/draft-input-arg-<for>.txt` by the read rule, at most 4096 bytes, with no character of Unicode category Cc, Cf, Zl or Zp except one final LF (else `refused: argument is not accepted`). The file is one-shot: once an entry exists at that path it is removed with `unlink` (which never follows a link), whatever the outcome, so a stale argument is never read twice. No entry → `refused: no argument file`, exit 3.
On the trimmed text, the first match wins:
1. `--for grill` and the text is `resume <slug>` with a valid slug, or a path that, with `\` read as `/`, equals `.company/work/<slug>/grill.md` with a valid slug → `arg: resume <slug>`.
2. One token with no whitespace that holds `/` or `\`, or ends `.md` or `.txt` → `\` becomes `/`, the `plan-tasks` v1.3 path rule applies (fail → `refused: path <reason>`, `<reason>` the path rule's word, exit 3) → `arg: file <path>`.
3. Otherwise: `--for to-tickets` → `refused: needs a file`, exit 3; `--for feature` → `arg: idea`; `--for grill` or `--for to-spec` → `arg: idea`, then `slug: <s>`, where the base comes from the text's words by the slug rule and `<s>` is the `free` result for that base.

Empty after trimming → `refused: no argument`, exit 3. Exit 0 otherwise. `arg` never prints the argument text.

## Scope in `aico:feature` (R-12, CEO)
- Draft intake (the argument file, `arg --for feature`, `take --for feature`) applies only to draft files, the outputs of grill, to-spec and to-tickets: `.company/work/<s>/grill.md`, `.company/work/<s>/spec.md`, `.company/work/<s>/plan.md`.
- The feature Lead writes the argument file only when the trimmed argument is one token with no whitespace ending `grill.md`, `spec.md` or `plan.md`. It runs `take --for feature` only when `arg` printed `arg: file <path>` with `<path>` in one of those three forms; `take --for feature` itself refuses any other path (`refused: not a draft file`, exit 3).
- Every other argument (a description, a research-report or brainstorm path from a hand-over, a request with its triage line, any other `arg:` result) starts the run exactly as today: the argument is the CEO's request, with no `take`, no 256 KiB cap and Setup's slug.

## Slug rule (R-3)
- Base words: the text (or the file stem) lowercased; every run of characters outside `a-z0-9` becomes one `-`; leading and trailing `-` removed; at most the first 5 words kept; cut to 62 characters, trailing `-` removed; empty → `draft`.
- The base always matches `^[a-z0-9][a-z0-9-]{0,61}$`, so `<base>-9` is at most 64 characters.
- A base taken from `.company/work/<s>/` is `<s>` cut the same way.

## Kind
First match wins, on the bytes read:
- `spec`: a frontmatter (first line `---`, fifth line `---`) whose three lines are exactly the keys `slug`, `version`, `shipped`, in that order.
- `grill`: a frontmatter holding the line `format: 1`, and a line `## Log`.
- `plan`: a line `## Tasks` followed by at least one task heading `T<n>` (`plan-tasks` v1.3 task syntax).
- `brief`: a line that, after trimming, matches `^(?:[-*] )?\**AC\d{1,3}\**:` (no two quantifiers over one class side by side).
- `text`: anything else.

## `free <slug> --for <grill|to-spec|to-tickets|feature>`
Prints `slug: <s>`. `<slug>` must match the slug pattern (else `refused: bad slug`, exit 3). Candidates in order: `<slug>`, then `<b>-2` … `<b>-9`, where `<b>` is `<slug>` cut to 62 characters, trailing `-` removed. The first free candidate wins (R-10). A candidate is free only when:
- its folder `.company/work/<candidate>` does not exist; or
- (not for `feature`) it is a real folder (`lstat`, no link) whose entries are only draft files (`grill.md`, `spec.md`, `plan.md`, `input-*.md`) and it lacks both the output file of `<for>` (`grill.md` for grill, `spec.md` for to-spec, `plan.md` for to-tickets) and `input-<for>.md`. Any other entry, such as a Handoff, `00-summary.md`, `NN-architect-plan.md` or a subfolder, makes it not free.

For `--for feature` a candidate is free only when its folder does not exist. None free → `refused: no free slug`, exit 3. `free` writes nothing.

## `take <path> --for <grill|to-spec|to-tickets|feature>`
`<path>` is the `arg: file` value; it must pass the path rule (else `refused: path <reason>`). The file is read once by the read rule.
- Base: `<s>` when the file is `.company/work/<s>/grill.md` or `.company/work/<s>/spec.md`; `<s>-draft` for any other file under `.company/work/<s>/`; else the file stem. Then the slug rule and the `free` rule for `<for>`.
- `--for to-tickets` needs kind `spec` with a non-empty `## Problem` and `## Solution` (at least one non-blank line before the next `## ` line), or kind `brief`. Otherwise, before anything is written, one line `missing: <what>` per gap (`## Problem`, `## Solution`, or `a spec (## Problem, ## Solution) or a brief (AC<n>: lines)` when the kind is neither), exit 4 (AC39). It never invents criteria.
- Writes a byte copy of the bytes already read (never a second read) to `.company/work/<slug>/input-<for>.md`. Folders are created without following links: `.company/work` must pass the real-path test as a folder (missing parts are made one level at a time with a non-recursive `mkdir`, each checked by `lstat` as a folder, not a link), then `<slug>` likewise. The file is opened `O_CREAT|O_EXCL|O_WRONLY`, plus `O_NOFOLLOW` off win32.
- Prints `slug: <s>`, `input: .company/work/<s>/input-<for>.md`, `kind: <k>`, then one of:
  - kind `spec`: `spec: ready`, `spec: not ready, <e> errors` or `spec: not ready, over 64 KiB` (R-4): the 64 KiB cap first, then `checkText` on the copied bytes.
  - kind `grill`: `grill: <n> answered, <k> open` (`parseGrill`).
  - kind `plan`: `plan: <t> tasks`.
  - kind `brief`: `brief: <a> criteria` (the matching AC lines).
  - kind `text`: `text: <l> lines`.
- Exit 0. Roles read only the copy, never the original path.

### `take --for feature` (R-7)
There is no `--slug`. The path must be one of the three draft forms of "Scope in `aico:feature`". The run slug is the `free` result for `feature` (a folder that did not exist), so it never equals the draft's folder. `take` runs before pipeline Setup item 1, and the printed slug becomes the task slug. If Setup item 1 refuses that slug, the Lead runs `take` again: the used folder now exists, so the next slug is picked.

## `stale <path>`
`<path>` passes the path rule and is read by the read rule; its kind must be `plan` (else `refused: not a plan`, exit 3). It needs a `Base commit: <id>` line before `## Tasks`, `<id>` matching `^[0-9a-f]{40}$` or `^[0-9a-f]{64}$` and the repo's object format (40 for `sha1`, 64 for `sha256`), else `refused: plan has no Base commit line`, exit 3.

git rules:
- `spawnSync` with an argument array and no shell, cwd the product root, a timeout of 10 seconds per call.
- env = `process.env` minus every key matching `/^GIT_/i`, plus fixed keys only: `GIT_NO_REPLACE_OBJECTS=1`, `GIT_LITERAL_PATHSPECS=1`. Every call passes `--no-replace-objects` before the subcommand.
- Before any other call: `git rev-parse --git-path info/grafts` in that env; an entry at that path (`lstat`, any type) → `refused: grafts file present`, exit 3. Then `git rev-parse --show-object-format` gives the object format.
- Revisions follow `--end-of-options`; the base is the checked hex id, never a ref name.

Calls and codes (R-14), in order:
1. Base check: `git rev-parse --verify -q --end-of-options <base>^{commit}`. Exit 0 with one full hex id of the repo format → go on. Exit 1 → print only `base unknown <first 12 hex of base>`, exit 2, no path lines.
2. Per task `files:` item that passes the path rule, in plan order (a trailing `/` removed), the object id at each rev by `git rev-parse --verify -q --end-of-options <base>:<path>` and `git rev-parse --verify -q --end-of-options HEAD:<path>` (never `diff`). Exit 0 with one full hex id → that id; exit 1 → missing at that rev.
   - existed at base and missing at HEAD → `stale <id> <path> gone`;
   - missing at base and present at HEAD → `stale <id> <path> exists`;
   - existed at both and the ids differ → `changed <id> <path>`;
   - `<id>` is the task id.
3. Last line `draft-input stale: <s> stale, <c> changed`; exit 2 when s > 0, else 0.

Any other exit code from any call (128 included), a timeout, a spawn error or output that is not one full hex id → one line `error: git <exit <code> | timeout | not found | bad output>`, exit 1, never a `draft-input stale:` line (fail closed, git.M4).

## Plan Gate use in `aico:feature` (R-13)
- (a) Each `stale <id> <path> gone|exists` line is a Blocking `[spec]`. Each `changed <id> <path>` line is info, not Blocking: the Lead passes it to the architect and lists it in the Plan Gate summary.
- (b) `stale` counts as checked only when it exits 0 or 2 and its output holds a `draft-input stale:` summary line. Every other result is one Blocking `[spec] stale not checked: <first line>`, where `<first line>` is the first line of the script's standard output, or `no output` when it printed none. That covers `refused: plan has no Base commit line` (every plan written before v0.22), a `base unknown` line, exit 1, every other refusal (`refused: grafts file present`, `refused: link`, `refused: missing`, `refused: hard-linked`, `refused: not UTF-8`, `refused: not a plan`, `refused: path <reason>` and the rest), any other exit code, and a run that prints nothing (fail closed). This rule tightens what the Lead accepts; it adds no command, output line or exit code, so the Contract stays v1.
- (c) The architect writes the run's plan from the draft. A `stale` Blocking closes by a `Decided (stale <id> <path>):` line in that plan, one per stale line, saying how the plan handles the path (dropped, re-created or moved). A `stale not checked` Blocking closes by one `Decided (stale not checked):` line stating that every `files:` path of the draft was checked against HEAD.
- Before the Plan Gate the Lead checks that each such line exists; one missing goes back to the architect once, then shows as open at the Plan Gate. `stale` is not rerun on the run's plan.
- A draft input adds no Gate approval: the Brief Gate and the Plan Gate run as for any feature run (AC44), and the plan reviewer runs as the tier set says.

## Error cases
- Every refusal writes nothing (the argument file's removal in `arg` is not a write of the product).
- `scripts/draft-input.mjs` cannot run or prints nothing → the calling Playbook stops (fail closed); in the `aico:feature` Plan Gate that result is the `stale not checked: no output` Blocking of (b).
- A Role or Handoff that names a file to take is never enough: only the CEO's argument, through the argument file, reaches `arg`.

## Compatibility
New Contract. A new command, kind, output line or exit code needs a new version.
