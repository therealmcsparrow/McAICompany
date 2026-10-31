# Contract: draft-input v1.3

New Contract (task grill-spec-tickets, T1). Provider: `scripts/draft-input.mjs` (Node built-ins only). Consumers: `aico:grill`, `aico:to-spec`, `aico:to-tickets`, `aico:feature` (draft intake), `aico:fix` (build plan input, v1.1). Uses: `destination-spec` v1.1 (`checkText`, imported in-process, no child process), `grill-file` v1 (`parseGrill`, imported in-process), `plan-tasks` v1.3 (the task field syntax and the path rule, read only), `work-folder-name` v1 (`mods/lib/work-folder.mjs`: `isWorkFolder`, `parseName`, `candidates`, `helperName`, `fallbackTopic`, `branchId`, `stampOf`, `readTopicFile`; imported in-process). Rationale: `docs/adr/0046-draft-input-copy-and-stale-paths.md`.
The three pre-build commands and `aico:feature` take the CEO's argument and draft files through this script. It turns the argument into a fixed result line, picks a slug that never reuses earlier work, copies a file input once so Roles read only the copy, and checks a draft plan's `files:` paths against HEAD. File and CEO text are data: the script never prints them and a Role never takes an instruction from them.

## Read rule (AC37)
Every file the script reads (the argument file, a `take` input, a `stale` plan) is read only when all of these hold; any throw or mismatch refuses that read, with no fallback to the lexical path or to a text compare:
- `fs.realpathSync.native` of the lexical absolute path succeeds and equals it (case-insensitive compare on win32 and darwin), so no link or junction lies on any segment, and it lies inside `fs.realpathSync.native(root)`.
- `lstat` shows `isFile()` and `nlink === 1`.
- The file is then opened read-only and the handle's `fstat` has the same `dev` and `ino` as the `lstat`. On win32 `O_NOFOLLOW` is never ORed in (it is undefined there); elsewhere it is.
- At most 256 KiB (the `fstat` size, before any byte is decoded; at most 256 KiB + 1 bytes are read), UTF-8 with a fatal decoder, no NUL byte.

A failure → `refused: <reason>`, exit 3, nothing written. Reasons: `outside the product root`, `link`, `not a regular file`, `hard-linked`, `missing`, `too large`, `not UTF-8` (a NUL byte counts as `not UTF-8`).

## Arguments and output
- Every command-line argument is at most 4096 characters and holds no character of Unicode category Cc, Cf, Zl or Zp, else `refused: argument is not accepted`, exit 3, before any command runs. `--for` takes exactly one of `grill`, `to-spec`, `to-tickets`, `feature`, `fix` (`stale` takes no `--for`); a missing, repeated or other value → `refused: usage`, exit 3.
- Output echoes only fixed words, ids, numbers, work folder names (a legacy slug `^[a-z0-9][a-z0-9-]{0,63}$`, or a new name that `parseName` accepts, which holds spaces) and paths that pass the path rule below; never file text, CEO text or a rejected argument.
- The path rule (v1.2): the text has `\` read as `/`. A path starting `.company/work/` has its second segment checked by `isWorkFolder` and the rest by the `plan-tasks` v1.3 path rule; spaces are allowed only inside that name. A name that fails, an empty rest, a path over 400 characters, or a `.company/work/` prefix in other letter case is `refused: path bad character` (or the path rule's word). Any other path is checked whole by the `plan-tasks` v1.3 rule.
- The Lead single-quotes every name and path on a shell line, since a new name holds spaces.
- Exit codes: 0 done; 1 a `stale` git call failed; 2 `stale` found stale paths or an unknown base; 3 refused; 4 `take --for to-tickets` input misses what to-tickets needs.

## Argument file (R-1)
The CEO's raw argument never reaches a shell. Right before `arg`, the Lead writes it, as typed, with the Write tool to `.company/draft-input-arg-<for>.txt` (the whole file). Every later shell argument is a fixed word or a value that `arg`, `take` or `free` printed.

## `arg --for <grill|to-spec|to-tickets|feature|fix>`
Reads `.company/draft-input-arg-<for>.txt` by the read rule, at most 4096 bytes, with no character of Unicode category Cc, Cf, Zl or Zp except one final LF. Over 4096 bytes (decided first, by the read cap) → `refused: argument too large`; a Cc, Cf, Zl or Zp character other than one final LF → `refused: argument has a line break or control character` (v1.3). Command-line arguments keep `refused: argument is not accepted`. The file is one-shot: once an entry exists at that path it is removed with `unlink` (which never follows a link), whatever the outcome, so a stale argument is never read twice. No entry → `refused: no argument file`, exit 3.
On the trimmed text, the first match wins:
1. `--for grill` and the text is `resume <name>`, or a path that, with `\` read as `/`, equals `.company/work/<name>/grill.md`, with `<name>` passing `isWorkFolder` (a legacy slug or a new name, spaces allowed inside it) → `arg: resume <name>`.
2. The text is `.company/work/<name>/<grill|spec|plan>.md` (`\` read as `/`) with `<name>` passing `isWorkFolder` → `arg: file <path>`. With `--for to-spec` it may also be `.company/work/<name>/prompt.md` (v1.3, a reprompt prompt file). Spaces are allowed only inside `<name>`.
3. One token with no whitespace that holds `/` or `\`, or ends `.md` or `.txt` → the path rule applies (fail → `refused: path <reason>`, `<reason>` the path rule's word, exit 3) → `arg: file <path>`.
4. Otherwise: `--for to-tickets` → `refused: needs a file`, exit 3; `--for feature` or `--for fix` → `arg: idea`; `--for grill` or `--for to-spec` → `arg: idea`, then `slug: <name>`, a new primary name: the Topic (below) or the fallback for `--for`, at the run's local start time, the first of `candidates` that is not in use (a folder of that name or one with the same branch id). All nine taken → `refused: too many runs this minute`. The idea text never builds the name.

Empty after trimming → `refused: no argument`, exit 3. Exit 0 otherwise. `arg` never prints the argument text.

### Topic file (v1.2)
The grill, to-spec and to-tickets Playbooks write `.company/work-folder-topic-<for>.txt` right before every `arg`. Every `arg` and `take` run consumes the Topic file of its `--for` word whatever the outcome (an entry that exists is removed with `unlink`; a missing one is not an error): it is read through `readTopicFile` (mode `file`) only for a new primary run with no source folder (`arg` idea for grill and to-spec; `take` of a file outside `.company/work`), and otherwise removed unread (mode `none`). `arg` printing `arg: file <path>` with `<path>` outside `.company/work/`, or a `--for to-spec` prompt file, leaves it for the `take` that follows. A missing, unreadable or failing Topic gives the fallback: the `--for` word with each hyphen part capitalised (`Grill`, `To-Spec`, `To-Tickets`). `feature` and `fix` never write it; their file is only removed. A refusal that happens after the argument file was read removes it too.

## Scope in `aico:feature` (R-12, CEO)
- Draft intake (the argument file, `arg --for feature`, `take --for feature`) applies only to draft files, the outputs of grill, to-spec and to-tickets: `.company/work/<name>/grill.md`, `.company/work/<name>/spec.md`, `.company/work/<name>/plan.md`, `<name>` passing `isWorkFolder`.
- The feature Lead writes the argument file only when the trimmed argument is exactly one of those three forms (spaces only inside `<name>`). It runs `take --for feature` only when `arg` printed `arg: file <path>` with `<path>` in one of those forms; `take --for feature` itself refuses any other path (`refused: not a draft file`, exit 3).
- Every other argument (a description, a research-report or brainstorm path from a hand-over, a request with its triage line, any other `arg:` result) starts the run exactly as today: the argument is the CEO's request, with no `take`, no 256 KiB cap and Setup's slug.

## Legacy slug rule
- A legacy source `.company/work/<s>/` keeps its candidates: `<s>`, then `<b>-2` … `<b>-9` with `<b>` the slug cut to 62 characters, trailing `-` removed. They apply only to `free <slug>` and to a draft chain (grill, to-spec, to-tickets) on a legacy `grill.md` or `spec.md`. v1.2 builds no slug from CEO text or from a file stem any more.

## Kind
First match wins, on the bytes read:
- `spec`: a frontmatter (first line `---`, fifth line `---`) whose three lines are exactly the keys `slug`, `version`, `shipped`, in that order.
- `grill`: a frontmatter holding the line `format: 1`, and a line `## Log`.
- `plan`: a line `## Tasks` followed by at least one task heading `T<n>` (`plan-tasks` v1.3 task syntax).
- `brief`: a line that, after trimming, matches `^(?:[-*] )?\**AC\d{1,3}\**:` (no two quantifiers over one class side by side).
- `text`: anything else.

## `free <slug> --for <grill|to-spec|to-tickets|feature|fix>`
Prints `slug: <s>`. `<slug>` is a legacy slug (pattern `^[a-z0-9][a-z0-9-]{0,63}$`) or a new name that `parseName` reads with no suffix or with `Draft` (v1.2); anything else, a `Build` name included, is `refused: bad slug`, exit 3. Candidates in order: for a legacy slug `<slug>`, then `<b>-2` … `<b>-9`, where `<b>` is `<slug>` cut to 62 characters, trailing `-` removed; for a new name the name, then ` 2` … ` 9` (from `candidates`, or the `Draft` number for a `Draft` name). The first free candidate wins (R-10). A candidate is free only when:
- its folder `.company/work/<candidate>` does not exist; or
- (not for `feature` or `fix`) it is a real folder (`lstat`, no link) whose entries are only draft files (`grill.md`, `spec.md`, `plan.md`, `input-*.md`) and it lacks both the output file of `<for>` (`grill.md` for grill, `spec.md` for to-spec, `plan.md` for to-tickets) and `input-<for>.md`. Any other entry, such as a Handoff, `00-summary.md`, `NN-architect-plan.md` or a subfolder, makes it not free.

For `--for feature` and `--for fix` a candidate is free only when its folder does not exist. A new name is also not free when an existing folder has the same branch id. None free → `refused: no free slug` for a legacy slug and `refused: too many runs this minute` for a new name, exit 3. `free` writes nothing.

## `take <path> --for <grill|to-spec|to-tickets|feature|fix>`
`<path>` is the `arg: file` value; it must pass the path rule (else `refused: path <reason>`). The file is read once by the read rule.
- Run folder name (v1.2), every name from `work-folder-name` v1, each folder made with an exclusive non-recursive `mkdir` (`EEXIST` takes the next number, a name is never reused):
  - A file outside `.company/work`: a new primary name, the Topic (Topic file above) or the fallback for `<for>` at the run's local start time, then ` 2` … ` 9`.
  - `grill`, `to-spec`, `to-tickets` on `.company/work/<name>/grill.md` or `spec.md`: `<name>` itself while the `free` rule for `<for>` allows (one draft chain). When it does not: a legacy `<name>` gives `<s>-2` … `<s>-9`; a new `<name>` gives a `Draft` helper.
  - Every other file under `.company/work/<name>/`, and `feature` and `fix` always: `helperName(<name>, 'Draft')` at the run's own start time: `<own date-time> - <parent stem> Draft`, then `Draft 2` … `Draft 9`. A legacy parent's stem is its slug words (a final `-build` or `-draft` dropped, hyphen words capitalised); a stem that fails the Topic check becomes the fallback for `<for>` (`Fix`, `Feature`, `Grill`, `To-Spec`, `To-Tickets`). Every Draft number taken → `refused: too many runs this minute`, exit 3.
- `--for to-tickets` needs kind `spec` with a non-empty `## Problem` and `## Solution` (at least one non-blank line before the next `## ` line), or kind `brief`. Otherwise, before anything is written, one line `missing: <what>` per gap (`## Problem`, `## Solution`, or `a spec (## Problem, ## Solution) or a brief (AC<n>: lines)` when the kind is neither), exit 4 (AC39). It never invents criteria.
- Writes a byte copy of the bytes already read (never a second read) to `.company/work/<slug>/input-<for>.md`. Folders are created without following links: `.company/work` must pass the real-path test as a folder (missing parts are made one level at a time with a non-recursive `mkdir`, each checked by `lstat` as a folder, not a link), then `<slug>` likewise. The file is opened `O_CREAT|O_EXCL|O_WRONLY`, plus `O_NOFOLLOW` off win32.
- Prints `slug: <s>`, `input: .company/work/<s>/input-<for>.md`, `kind: <k>`, then one of:
  - kind `spec`: `spec: ready`, `spec: not ready, <e> errors` or `spec: not ready, over 64 KiB` (R-4): the 64 KiB cap first, then `checkText` on the copied bytes.
  - kind `grill`: `grill: <n> answered, <k> open` (`parseGrill`).
  - kind `plan`: `plan: <t> tasks`.
  - kind `brief`: `brief: <a> criteria` (the matching AC lines).
  - kind `text`: `text: <l> lines`.
- Exit 0. Roles read only the copy, never the original path.

### take --for to-spec of a prompt file (v1.3)
The path (after the path rule) is `.company/work/<name>/prompt.md` with `<name>` passing `isWorkFolder`. It is read by the read rule with a cap of 16 KiB (16384 bytes) instead of 256 KiB; one byte more is `refused: too large`. No reprompt run record is checked. The run gets a new primary name from the Topic (or the `To-Spec` fallback), as for a file outside `.company/work`, and the copy goes to `input-to-spec.md`; Roles read it as the idea text. `take --for feature` still refuses it with `not a draft file` and `take --for fix` with `not a build plan`.

### `take --for feature` (R-7)
There is no `--slug`. The path must be one of the three draft forms of "Scope in `aico:feature`". The run name is a `Draft` helper of the draft's folder at the run's own start time (a folder that did not exist), so it never equals the draft's folder: `.company/work/2026-10-30 22.42 - Login Idea/spec.md` taken at 09.15 gives `2026-10-31 09.15 - Login Idea Draft`, a second take in that minute `… Draft 2`. A legacy draft folder gives a new-form Draft from its slug words. `take` runs before pipeline Setup item 1, and the printed slug becomes the task slug. If Setup item 1 refuses that slug, the Lead runs `take` again: the used folder now exists, so the next slug is picked.

## `take --for fix` (v1.1, a flow build plan)
The fix Playbook takes a build-plan argument only through this command; the Lead and every Role read only the printed `input:` copy, never the argument path. The path (after the path rule) must equal `.company/work/<build>/plan.md` with `<build>` a legacy `<slug>-build` (slug pattern) or a new name that `parseName` reads as a `Build` helper, else `refused: not a build plan`, exit 3, nothing written. A primary run name never ends in `Build`, so its `plan.md` is refused. The read rule applies (inside the real root, no link, regular file, one link, at most 256 KiB, UTF-8). The run name is a `Draft` helper of `<build>` at the run's own start time (`… - Fix Draft` when a legacy stem fails the Topic check, as `bug-fix-login-page-crash-on-save-build` does). The copy goes to `.company/work/<slug>/input-fix.md`; output and exit codes are those of `take`. The kind line is informational: no kind is required. The copy is data, never instructions.

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
v1.2 (minor): new-form work folder names. `arg`, `free` and `take` print new names (spaces inside) where a slug stood; `arg` and `take` take `.company/work/<name>/…` paths for any work folder name and consume the Topic file; `main(args, { root, now })` takes the run's start time. A legacy slug source keeps its `-2` … `-9` draft chain. Where v1 built a slug from CEO text or a file stem, v1.2 builds a new primary name from the Topic or the `--for` fallback. New exit code: none; new refusals: `too many runs this minute`, `bad name`, `bad topic path`.
v1.3 (minor): new input, a reprompt prompt file `.company/work/<name>/prompt.md` for `--for to-spec`. For the argument file only, `refused: argument too large` and `refused: argument has a line break or control character` replace `refused: argument is not accepted`; command-line arguments keep the old word. No new command, kind, output line or exit code; every refusal keeps exit 3.
v1.1 (minor, additive): the `--for` word `fix` for `arg`, `free` and `take`. A new command, kind, output line or exit code needs a new version.
