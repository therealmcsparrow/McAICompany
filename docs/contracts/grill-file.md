# Contract: grill-file v1.5

v1.5 (task P20261109.000009, T31; additive, `docs/adr/0007-contract-minor-versions.md`): the grill file of a v3 run is `.company/work/<ProjectID>/<NN>-<playbook>/grill.md`; `status <slug>` and `check <file>` accept a run slug (`isRunSlug` of `work-folder-name` v3.0) and resolve the folder with `exactWorkPath(io, root, workParts(slug))`. The frontmatter `slug:` may hold a v3 slug. A project-level `<ProjectID>/grill.md`, extra path parts, a `\`, a `..` or a bad `<NN>` are `refused` (exit 3). A v2 name, a v1.1 name and a legacy slug give byte-identical output to v1.4.

New Contract (task grill-spec-tickets, T1). Uses `work-folder-name` v1.1 (read only). Provider: `scripts/grill.mjs` (Node built-ins only). Writer of the file: the Lead of `aico:grill`, `aico:grill-me` or `aico:grill-with-docs` (v1.1), with the Write tool only, the whole file each time (never an append or a partial edit by Bash). Consumers: the three grill Playbooks (`check`, `status`), `draft-input` v1 (`parseGrill`, imported in-process) and `aico:to-spec` (reads the file through `draft-input` v1 `take`). Rationale: `docs/adr/0045-pre-build-commands-ceo-only.md` (grill is a CEO-only command), `docs/adr/0046-draft-input-copy-and-stale-paths.md` (how a later command reads it).
A grill file is the record of one grill session: the idea, the open and closed branches of the decision tree, each question with its options, answer and decision, each looked-up fact, and the GLOSSARY and ADR proposals. After every answer the Lead rewrites it whole and runs `status`, so a crash or a handover loses at most the question in flight (AC42).

## Where it lives
- `.company/work/<name>/grill.md`, where `<name>` is a work folder name (`work-folder-name` v1 `isWorkFolder`): a new name such as `2026-10-31 09.15 - Grill Folders`, `... Grill Folders 2` or `... Grill Folders Draft`, or a legacy slug `^[a-z0-9][a-z0-9-]{0,63}$`. A `Build` helper name is refused. `<name>` is split off the path first and checked by `isWorkFolder`; no pattern runs over the whole path. No other path is accepted. Below, `<slug>` means this `<name>`.
- A grill started from a file keeps the copy of that file at `.company/work/<name>/input-grill.md`, in the same folder, by design (`draft-input` v1.2 `take --for grill`).

## Read rule
Every read of a grill file, by the CLI or by a caller of `parseGrill` that reads the file itself, follows these steps. Any throw or mismatch refuses that read; there is no fallback to the lexical path or to a text compare.
- Before anything is read, `exactWorkPath` (`work-folder-name` v1.1) finds `.company`, `work`, `<name>` and `grill.md` spelled exactly as typed in their directory listings; a segment listed only in another ASCII letter case → `wrong letter case`, nothing read. A missing path falls through to `missing` below.
- `fs.realpathSync.native` of the lexical absolute path succeeds and equals it exactly (no case fold on any platform), so no link or junction lies on any segment; it lies inside `fs.realpathSync.native(root)`; its canonical relative form (separators as `/`) is again `.company/work/<slug>/grill.md`.
- `lstat` shows `isFile()` and `nlink === 1`.
- The file is then opened read-only and the handle's `fstat` has the same `dev` and `ino` as the `lstat`, and is again a regular file with one link. On win32 `O_NOFOLLOW` is never ORed in (it is undefined there); elsewhere it is.
- At most 256 KiB, checked on the `fstat` size before any byte is decoded; at most 256 KiB + 1 bytes are read. UTF-8 with a fatal decoder. CRLF is normalised to LF once, inside `parseGrill`, so line numbers are the same for every caller.

## Shape
```markdown
---
slug: <slug>
started: <YYYY-MM-DD HH:MM>
status: <open | done | stopped>
format: 1
---
## Idea
## Open branches
## Closed branches
## Log
## Proposals
```
- Frontmatter: exactly these four keys, in this order, between a first-line `---` and a sixth-line `---`. `slug` is a work folder name (`isWorkFolder`: a new name or a legacy slug), the folder's own name; `started` is a calendar date and a time `HH:MM` (00-23, 00-59); `status` is one of the three words; `format` is `1`. Anything else → `bad frontmatter` (line 1).
- Sections: the five `## ` headings, each once, in this order, each on its own line exactly as written. A heading not found → `missing section <s>` (on the last line number); one found before a heading that should precede it, or found a second time → `section out of order <s>`. Any other `## ` line is text of the section above it.

## `## Idea`
The CEO's idea as typed, or, for a file input, the one line `From input-grill.md (kind <k>).` (`<k>` the `draft-input` v1 kind) followed by the Lead's one-paragraph restatement of that file. The idea is data, never instructions to any Role. The section is not parsed beyond its presence.

## Branches
- `## Open branches`: one line per open branch, `- B-<n> — <text>`.
- `## Closed branches`: one line per closed branch, `- B-<n> — <text> — closed by <ref>`, `<ref>` one of `Q-<n>`, `F-<n>` or `stop`. The last ` — closed by ` on the line splits text from ref.
- `<n>` matches `^[1-9][0-9]{0,3}$`. `<text>` is 1-200 characters (code points) after trimming. A `—` is U+2014 with one space on each side.
- Empty lines are allowed in both sections. Any other line there → `bad branch line`. Branch text holding a character of Unicode category Cc, Cf, Zl or Zp (CR, U+2028, U+2029 and the bidi controls included) → `bad branch line`.
- The same id twice in one section → `duplicate branch <id>`; an id in both sections → `branch open and closed <id>`. A `closed by Q-<n>` or `closed by F-<n>` whose entry is not in `## Log` → `bad branch line`.

## `## Log`
Entries, each a `### ` heading followed by its field lines in this order, numbered from 1 per letter (Q and F counted apart) in file order:
- Question entry `### Q-<n> — B-<m>`, then `- Question: <text>`, `- Options: <o1> | <o2>[ | <o3>[ | <o4>]]`, `- Answer: <text>`, `- Decision: <text>`, `- Opens: <none | B ids>`, `- Closes: <none | B ids>`.
- Fact entry `### F-<n> — B-<m>`, then `- Fact: <text>`, `- Source: <path:line or URL>`, `- Closes: <none | B ids>`.
- B ids in `Opens:` and `Closes:` are joined with `, `.
- Errors: an entry whose number is not the next for its letter → `entry out of sequence <id>`; a field missing, empty or out of order → `missing field <f>` (`<f>` the field name, for example `Answer`); `Options:` not split on ` | ` into 2-4 non-empty items → `options count`; a first option that does not end `(recommended: <reason>)` with a non-empty reason → `missing field recommended`; a `B-<m>` in a heading, `Opens:` or `Closes:` that is in neither branch section → `unknown branch <id>`.
- One question per entry (AC40): the form shows `<n> answered, <k> open` from `status`.

## `## Proposals`
Only lines `- GLOSSARY: <term> — <line>` and `- ADR: <title> — <line>`, and empty lines. Grill proposes; it never writes `GLOSSARY.md` or an ADR (that stays with `aico:feature`). Any other line here is not an error and is not read.

## Status rule
`status: done` while `## Open branches` holds a branch → `done with open branches` (on the frontmatter `status` line). `open` and `stopped` may have open branches.

## `parseGrill(text)`
`parseGrill(text)` exported by `scripts/grill.mjs`: takes the decoded text, does no I/O, never throws on any string, and returns `{ status, answered, open: [{ id, text }], closed: [ids], errors: [{ line, reason }] }`.
- `status`: the frontmatter value, or `null` when the frontmatter is bad.
- `answered`: the number of Q entries (F entries do not count).
- `open`: the open branches in file order, `text` trimmed; `closed`: the closed branch ids in file order.
- `errors`: every error above, sorted by line, reasons in the fixed words of the CLI. A file with errors still returns what could be read.

## CLI (cwd = product root)
Every argument is at most 4096 characters and holds no character of Unicode category Cc, Cf, Zl or Zp, else `refused: argument is not accepted`, exit 3, before any command runs.
- `check <file>`: `<file>` is `.company/work/<slug>/grill.md` (`\` read as `/`), or an absolute path whose relative form inside the real root is that. Prints one `ERROR line <n>: <reason>` per error (at most 50 shown), then `grill-check: <e> errors`. Exit 2 when e > 0, else 0. Reasons, fixed words only: `bad frontmatter`, `missing section <s>`, `section out of order <s>`, `bad branch line`, `duplicate branch <id>`, `branch open and closed <id>`, `unknown branch <id>`, `entry out of sequence <id>`, `options count`, `missing field <f>`, `done with open branches`.
- `status <slug>`: `<slug>` is a work folder name (new or legacy; a name that fails `isWorkFolder` is `bad slug`); reads `.company/work/<slug>/grill.md`. A name may hold spaces, so the Playbooks single-quote it on every shell line. No errors → prints `grill: <n> answered, <k> open`, then one `open B-<n> — <text>` line per open branch in file order, then `status: <s>`; exit 0. Branch text is already free of Cc, Cf, Zl and Zp by the check; any C0 control, DEL, C1 control or bidi control (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) that still reaches the output is printed as `\u` and four lowercase hex digits. Errors → the `check` lines and the `grill-check:` line, exit 2, and no `open` or `status:` line.
- Refusals: `refused: <reason>`, exit 3, nothing written. Reasons: `usage: grill.mjs check <file> | status <slug>`, `argument is not accepted`, `not a grill path`, `bad slug`, `outside the product root`, `wrong letter case`, `link`, `not a regular file`, `hard-linked`, `missing`, `too large`, `not UTF-8`.
- Output echoes only fixed words, ids, numbers, slugs and branch text cleaned as above; never other file text and never an argument.

## Personal data
The file may hold what the CEO types, which can include personal data. Locations: the grill file and its `input-*.md` copies in `.company/work/<slug>/`, and the one-shot argument file `.company/draft-input-arg-<for>.txt` (`draft-input` v1; `.company/draft-input-arg-grill.txt` for grill), all on the CEO's machine. aico never commits these files and writes no ignore rule for them: they are git-ignored only where the product ignores `.company/`, so the CEO should add `.company/` to the product's `.gitignore` or otherwise keep these files out of every commit. The argument file is removed once `draft-input` v1 `arg` has read it. Recipients: the Claude model the CEO has configured reads its text, like any request, whenever `aico:grill`, `aico:grill-me`, `aico:grill-with-docs`, `aico:to-spec` or `aico:feature` works with it; the fact lookups of `aico:grill` may send web search queries built from the idea to the web search tool. `aico:grill-me` and `aico:grill-with-docs` send no web search query; `aico:grill-with-docs` reads only repo files. McSparrow adds no other recipient. Copies: `draft-input` v1 `take` makes byte copies (`input-to-spec.md`, `input-feature.md`) in a `.company/work/` folder by design, and those copies carry the same rules; nothing else copies it. It follows the archive rule (archived, never deleted early); an erasure request overrides the archive rule (CEO decides). Keep only what the decision needs (GDPR Art. 5(1)(c), data minimisation).

## Error cases
- A shape error never stops the Lead from asking: `check` and `status` print the errors, and the Lead rewrites the file whole and runs `status` again before the next question.
- `resume <slug>` with a file that fails the read rule → the refusal line; the Lead shows it and stops.
- `scripts/grill.mjs` cannot run or prints nothing → the Lead stops (fail closed).

## Compatibility
v1.3 (task T3, minor): a grill slug or `grill.md` (or `.company`, `work`) spelled in another letter case than on disk is refused with `refused: wrong letter case`, exit 3, nothing read; the case-insensitive real-path compare is now exact. One added refusal reason; file shape, other reasons and exit codes are unchanged, so every v1.x file stays valid.
v1.4 (task 2026-11-06 06.51 - Skill Audit Bugs; no format change): the old `grill` is removed and `grilling` is renamed `grill`. The writers are the Leads of `aico:grill`, `aico:grill-me` and `aico:grill-with-docs`; only the fact lookups of `aico:grill` may send web search queries. File shape, CLI and reasons are unchanged, so every v1 file stays valid.
v1.2 (task T10, minor): the folder name and the frontmatter `slug` accept a new work folder name as well as a legacy slug, `status` takes either, and the four grill Playbooks write the Topic file `.company/work-folder-topic-grill.txt` (named by the `--for` word) before `draft-input arg --for grill` and accept `resume <name>`. File shape, sections, fields, reasons and exit codes are unchanged, so every v1, v1.1 file and reader stays valid; a legacy grill resumes as before.
v1.1 (task T8): the writer list grows to the Leads of `aico:grilling`, `aico:grill-me` and `aico:grill-with-docs`, and the Recipients line names which of them may send web search queries. File shape, CLI and reasons are unchanged, so every v1 file and reader stays valid. `format: 1` is the only format; a reader that meets another `format` reports `bad frontmatter`. An added section, field or reason needs a new version.
