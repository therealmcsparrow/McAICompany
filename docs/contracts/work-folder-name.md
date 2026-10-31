# Contract: work-folder-name v1.1

v1.1 (task Draft Input Folder Case Draft, T1; additive, `docs/adr/0007-contract-minor-versions.md`): a work folder or file typed in another letter case than the one on disk is refused on every platform. New export `exactWorkPath(io, root, rel)`: `rel` is the list of parts under `.company/work`; it checks `.company`, `work` and each part against the directory entries (`readdirSync`), never against `realpath` output. Result `exact` (every part is listed as typed) or `missing` (a part is listed in no letter case); a part listed only in another ASCII letter case throws `WorkFolderRefusal('wrong letter case')`. The ASCII-only fold only picks these refusal words and never grants access, so U+212A and other look-alikes stay different names (`missing`). With case twins the typed spelling wins. `checkWorkDirs` runs this check for `.company` and `work`, and `realDir` and the Topic-file parent compare real paths exactly (no case fold). `work-folder branch '<name>'` prints `refused: wrong letter case` (exit 3, nothing written) for a name or `.company`/`work` folder in another case; a name missing in every case stays `refused: unknown name`. Callers run the name-shape check first, then `exactWorkPath`, then the link and escape checks. Every v1 caller and every exact spelling behaves as before.

New Contract (task idea-20261030-2242-build-draft, T3). Provider: `mods/lib/work-folder.mjs` (pure, no imports; file calls come in through an `io` object) and `scripts/work-folder.mjs` (Node built-ins only). Consumers: every script, mod and Playbook that names, parses or resumes a work folder; `draft-input` and `ticket-approval` (`helperName`, `readTopicFile`), `aico:pipeline` Setup (`work-folder new`).
Work folders are named `YYYY-MM-DD HH.MM - Topic` in local start time. One shared module holds the allow-lists; no other file repeats the pattern. Legacy slugs stay readable and are never renamed.

## Names
- Topic (`checkTopic`): ASCII, `^[A-Z0-9][A-Za-z0-9]*([ -][A-Z0-9][A-Za-z0-9]*)*$`, at most 60 characters, at most 5 space-separated words. The last word that is not all digits is not a suffix word (`Build`, `Draft`, compared without case). So `Fix-login`, `Fix Login Build` and `Fix Draft 2` fail; `Release 2` and `Build Pipeline Fix` pass.
- New name: `YYYY-MM-DD HH.MM - <stem>[ <Suffix>[ <n>]]`, a real calendar date, `HH` 00-23, `MM` 00-59, at most 120 characters. The dot of `HH.MM` is the only dot, so `..`, `/`, `\`, quotes, `$`, backtick and a trailing dot fail by shape.
- `parseName(name)` returns `{ stamp, stem, suffix, number }` or null. The words after ` - ` are split: a final ` Draft` or ` Draft <2-9>` gives suffix `Draft` and its number; a final ` Build` gives suffix `Build`; otherwise the name is a primary run (`suffix` null) whose stem is its Topic plus an optional collision number. The stem, or the stem minus one trailing ` <2-9>`, must pass `checkTopic`. A name ending ` Build <n>` returns null: a `Build` helper never takes a number.
- `isWorkFolder(name)` is true for a parsed new name or a legacy slug `^[a-z0-9][a-z0-9-]{0,63}$`.
- Suffix list is closed: `Build`, `Draft`. A new word needs a minor bump of this Contract. Suffix and number sit outside the Topic cap.
- `candidates(stamp, topic)` lists the plain name then ` 2` to ` 9`; `newName(stamp, topic, isTaken)` returns the first not taken, or null. `stampOf(date)` formats local time.

## Helper names (`helperName(parent, suffix, { stamp, fallback, isTaken })`)
- Stem is the parent's stem: the words after ` - ` minus only the parent's own final suffix and its number. A primary parent's collision number and a Topic's number word stay.
- `Build`: the parent's date-time, no number, `isTaken` is not asked. `2026-10-30 22.42 - Login Idea` gives `... - Login Idea Build`; `... - Login Idea 2` gives `... - Login Idea 2 Build`.
- `Draft`: the caller's own `stamp`, then ` 2` to ` 9` while `isTaken`. `2026-10-30 23.10 - Login Idea Draft`, then `... Draft 2`.
- Legacy parent: `Build` keeps `<slug>-build`. `Draft` is a new name: the slug minus a final `-build` or `-draft` (and an optional `-<2-9>`), hyphen words capitalised and joined by spaces, checked as a stem. If that fails, the stem becomes `fallback` (a `--for` word with each hyphen part capitalised, such as `Fix`, `To-Spec`) and the suffix stays: `2026-10-30 23.10 - Fix Draft`.
- null: a bad parent, suffix or stamp, a missing fallback when one is needed, or every Draft number taken (the caller prints `refused: too many runs this minute`).

## Branch id
`branchId(name)` is `YYYY-MM-DD-HHMM-` plus every word after ` - ` (Topic, suffix, number) lowercased and joined by `-`; Topic hyphens stay. `2026-10-30 23.45 - Fix Login Draft 2` gives `2026-10-30-2345-fix-login-draft-2`. A legacy name maps to itself. A new name whose branch id equals an existing folder's counts as a collision.

## Playbook id
`--playbook '<id>'` passes only `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters, and that check runs before any file call (else `refused: bad playbook`). Then `skills/<id>/SKILL.md` under the plugin root must be a regular file (`lstat`, no link). The fallback Topic is the id with each hyphen part capitalised; one that fails `checkTopic` is `refused: bad playbook`. `clear` checks only the id shape.

## Topic file and `readTopicFile(io, root, id, mode)`
The Lead writes the Topic as one line to `.company/work-folder-topic-<id>.txt` and never reads it back. No Topic text sits on a shell line. `io` is `{ fs, path, platform }` (the caller passes `node:fs` and `node:path`). Steps, each only after the one before passed:
1. Shapes: the id above; `--topic file|none`.
2. `.company` and `.company/work` are real folders (`lstat`, no link) whose real path is inside the real root, else `refused: bad topic path`, nothing read or removed.
3. The path is built from the passing id only; its real parent equals the real `.company`.
4. `lstat` of the entry. None: `refused: no topic file` with `file`, the fallback with `none`.
5. Read only a regular file with one link, at most 4096 bytes, `fstat` `dev` and `ino` equal to the `lstat`, `O_NOFOLLOW` where defined, fatal UTF-8 with the BOM kept, no character of category Cc, Cf, Zl or Zp except one final LF. A link, other entry type, hard-linked or oversized entry is not read and counts as a failed Topic. CR is Cc, so a CRLF file falls back.
6. The entry is removed with `unlink`, which never follows a link, whether or not it was read, and never before steps 1-3 passed. An entry that cannot be unlinked (a folder) is `refused: bad topic path`.
7. `checkTopic` on the text minus its one final LF, no other trimming. Fail: the fallback (no repair).
Returns `{ topic }` (the checked text) or `{ topic: null }` (fallback). Output never echoes rejected text. `mode none` skips step 5 and removes a stale entry. Accepted limit: the path is per id, so two concurrent runs of one Playbook in one repo can take each other's Topic; the other gets `refused: no topic file` or a checked Topic, never unchecked text.

## CLI
- `work-folder new --playbook '<id>' --topic file|none` makes `.company/work/<name>` with a non-recursive `mkdir` (never reuse; `EEXIST` or a branch-id collision takes the next number 2-9) and prints `name: <name>` and `branch: aico/<branch id>`. No `--suffix` or `--parent` option exists.
- `work-folder clear --playbook '<id>'` runs steps 1-3 and 6, prints `cleared` or `no topic file`, creates nothing.
- `work-folder branch '<name>'` prints `branch: aico/<branch id>` for an existing new or legacy folder (a real folder, no link) and writes nothing. A name that is not a work folder is `refused: bad name`; a missing folder `refused: unknown name`.
- Every refusal (`bad playbook`, `bad topic path`, `no topic file`, `too many runs this minute`, `bad name`, `unknown name`, `wrong letter case`, `usage`) prints `refused: <reason>`, exits 3 and creates nothing. Exit 0 otherwise. Skills pass a name only single-quoted.
