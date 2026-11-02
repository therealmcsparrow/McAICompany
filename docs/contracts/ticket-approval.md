# Contract: ticket-approval v1.3

New Contract (task reprompt-20261030-1309-draft-2-draft, T7); v1.1 is additive (work folder names, the `plan:` line). Provider: `scripts/ticket-approval.mjs` (Node built-ins only; `main(args, { now, root })` exported). Writer of the record: the Lead of `aico:idea` and `aico:bug`, only through the CLI and only at the CEO's pick in the main session. Consumers: the Lead (its own forms and the Ship Gate summary of a build run). No Gate and no Playbook reads this record to skip anything; it exists for the approve-once rule and the duplicate-approval metric.
Uses: `work-folder-name` v1.1 (`isWorkFolder`, `helperName`, `exactWorkPath`, from `mods/lib/work-folder.mjs`, read only). `<slug>` below is any work folder name: a legacy slug or a new name (spaces allowed inside it).
Uses: `plan-tasks` v1.3 (a ticket is one task block; the task ID pattern, the `files:`, `depends-on:` and `role:` field lines, the level 2-4 block rule) through the exports of `scripts/plan-markdown.mjs`. If `readPlanLines` is not exported there, the script is blocked; it never reads fences or headings itself and never edits that file.

## Ticket and hash
- A ticket is one plan-tasks v1.3 task: an ATX heading of level 2, 3 or 4 outside a code fence whose text starts with `^(T\d{1,3}[a-z]?)(?=$|[\s:.)-])`; its block runs to the next heading of the same or a lower level number (sub-headings and fenced lines belong to it). The title is the heading text after the ID and the separator characters that follow it.
- **Block hash:** the first 12 lowercase hex characters of SHA-256 over the UTF-8 block text: the lines from the heading through the last non-blank line, each with trailing spaces and tabs removed, joined with LF, one LF at the end. CRLF, LF and lone CR in the plan read the same. Any other change to the block (a field, a word, a line) changes the hash.
- A repeated ticket ID in one plan makes the plan unreadable (exit 1); no block is silently skipped.
- Limits: plan at most 256 KiB, at most 100 tickets, a line over 4000 characters outside a fence is never read as a heading or field (the `plan-markdown` rule).
- Plan words never count. A ticket whose text says "approved", holds a JSON line that looks like a record event, or names the Lead is a ticket like any other: only an `approve` event of the record, with the block's current hash, approves.

## Record `.company/work/<slug>/tickets.jsonl`
Slug: a work folder name (`isWorkFolder`: legacy `^[a-z0-9][a-z0-9-]{0,63}$` or a name `parseName` accepts); any other value is `refused: bad slug`. A `plan` event's `<slug>/<plan file name>` is checked the same way (name by `isWorkFolder`, file by the plan name rule, one `/`). Append-only (`O_APPEND`; the first append creates the file with `O_CREAT|O_EXCL`), LF, one JSON object per line, a line at most 8 KiB, the file at most 1 MiB and 5000 lines. The run folder and the file follow the real-path read rule (`proj.M-SEC7`): `realpathSync.native` of the lexical path equals it (exact, v1.2) and lies inside the real product root; `lstat` shows a regular file with one hard link; the opened handle has the same `dev` and `ino`; UTF-8 with a fatal decoder. A link, junction or hard link is refused.

| Key | Value | On |
|---|---|---|
| `v` | `1` | all |
| `n` | the line number, from 1 | all |
| `prev` | 12 hex: SHA-256 of the previous line's text (LF excluded); the first line holds `000000000000` | all |
| `at` | UTC `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`, written by the script | all |
| `ev` | `plan \| approve \| change \| park \| parked \| build` | all |
| `plan` | `<slug>/<plan file name>`, the plan the tickets are read from | plan |
| `id` | a ticket ID | approve, change, park, parked |
| `hash` | 12 lowercase hex, the block hash at the time of the event | approve, change, park, parked |
| `file` | the roadmap file name written by `park-ticket` | parked |
| `ids` | array of 1-100 ticket IDs | build |

Every key listed for an `ev` is required; every other key is refused. The chain (`n`, `prev`) makes an edited, removed, reordered or inserted line a broken record; an appended line with a valid chain cannot be told from the Lead's own, so the record is a **claim** (`proj.M-SEC8`): `read` and `build-plan` print every applied approve line, and the Lead shows each one verbatim, prefixed `> `, at the Ship Gate for the CEO to confirm.

## Status of a ticket
For ticket `id` with current hash `h` (the plan named by the last `plan` event, read now):
- `approved`: the last event of `id` with `hash == h` is `approve`.
- `parked`: the last event of `id` with `hash == h` is `parked`.
- otherwise open: `new` when the record holds no `approve`, `change`, `park` or `parked` event for `id`, else `changed` (events exist, none applies to `h`: the block changed after the CEO's answer, or the CEO answered `change` or `park` and has not approved since).
An approval counts only for the hash it was given at. `dup` is, over the record, the sum over every (`id`, `hash`) pair of (number of `approve` events minus 1) for pairs with at least one.

## CLI `scripts/ticket-approval.mjs` (cwd = product root)
Exit codes: **0** done; **1** the plan cannot be read (missing, unsafe, too large, not UTF-8, bad name, repeated ID, no `Base commit:` line for `build-plan`) or the record is broken (`ticket-approval: record <slug> line <n>: <reason>`); **3** refused (bad arguments, unknown ticket ID, a refused state change). Refusals print `refused: <reason>` and write nothing. An argument with a control character (Cc, Cf, Zl, Zp) or over 4096 characters is refused before any command runs. Plan names: `^(\d{2,3}-)?(architect-)?plan(-[a-z0-9]+)?\.md$`; a plan argument is that name (in the slug's folder) or `<other-slug>/<name>`.

| Command | Effect |
|---|---|
| `tickets <slug> <plan> --phase d\|f` | Reads the plan, appends a `plan` event when the plan differs from the last one, prints `tickets <n> phase <p>`, then one line per ticket in plan order. Phase d: `ask <id> new` for every ticket (every ticket is asked). Phase f: `ask <id> new\|changed`, `skip <id> approved` or `skip <id> parked`. After the ticket's line, `core <id>` when a `files:` item overlaps a Core path of `.company/project.md` (`## Core`, the `- <path>:` lines) and `contract <id>` when an item is under `docs/contracts/`; an item that fails the plan-tasks path rule is ignored. Output holds only fixed words and IDs |
| `ticket <slug> <id> approve\|change\|park` | Run by the Lead only at the CEO's pick. Re-reads the plan of the last `plan` event, appends the event with the block's current hash. `<id>` not in the plan → refused. No `plan` event yet → refused. A second `approve` for the same hash is written (it counts in `dup`) |
| `park-ticket <slug> <id>` | Refused unless the last event of `id` at the current hash is `park` (the CEO's pick), and while another ticket that depends on `id` (`depends-on:`) is not `parked`. Writes `.company/roadmap/<YYYY-MM-DD HH.MM> - <title>.md` (local time of `now`) with `O_CREAT|O_EXCL` inside the real `.company/roadmap` (created if missing; a link on `.company` or `roadmap` is refused), then appends `parked`. Prints `parked <id> <file name>`. The file is a title line, a line naming the ticket ID and the run slug, and the block. File name rule: the title keeps only `[A-Za-z0-9 -]`, spaces collapsed, trimmed, at most 60 characters, no trailing dot or space; an empty result becomes the ticket ID; a result that is a Windows device name (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`, any case) is refused. A file that exists is refused, never overwritten |
| `build-plan <slug>` | Refused while no ticket is approved. The folder name is `helperName(<slug>, 'Build')` only: a new flow `<stamp> - <stem>[ <n>]` gives `<stamp> - <stem>[ <n>] Build` (the flow's own stamp and number, none of its own), a legacy slug gives `<slug>-build`; no name (a flow name that cannot take a helper, a legacy slug too long) → refused. Writes `.company/work/<that name>/plan.md` with `O_CREAT|O_EXCL` (the folder is created without following a link, a folder made meanwhile is reused; an existing file is refused with `refused: file exists`, the plan unchanged): the plan's title line (first `# ` heading, else `# Build plan`), the plan's `Base commit: <40-64 hex>` line (none → exit 1), the plan-wide Decided lines (lines that start `Decided:` after an optional list marker, outside every ticket block, in plan order), then the plan's other sections (every line outside every ticket block, in plan order, except the title, the `Base commit:` line and the Decided lines already written; a section left empty is dropped; a heading in them that is a level 2-4 ticket heading or is titled `Tasks` is written with a leading `\` so it is plain text), `## Tasks`, then the approved blocks in plan order, each as hashed. Appends `build` with the approved IDs. Prints `built <n> tickets`, then `plan: <path>` (`.company/work/<name>/plan.md`, built only from the checked folder name), then one line per applied approve event (the record line, for the Ship Gate). The refused `file exists` run prints `refused: file exists` then the same `plan: <path>` line, exit 3. The Lead uses only that printed path, single-quoted, since a new name holds spaces |
| `read <slug>` | Read-only. No record → `state none`. Else prints `state on`, `plan <ref>`, `events <n>`, `dup <k>`, `approved <n>` and one line per applied approve event (the record line as stored). A plan that cannot be read → exit 1 |

## Errors
Plan unreadable (exit 1), unknown ticket ID (exit 3), broken record (exit 1, fail loud, nothing written). No Gate reads the record.

## Personal data
Ticket blocks and roadmap files hold CEO and model text. They stay local in the product's `.company/` (git-ignored where the product ignores it), are read by the CEO's Claude model and no other recipient, and are archived, never deleted. The record holds IDs, hashes, plan references and file names only.

## Compatibility
v1.3 (minor, behavior): `build-plan` keeps the source plan's other sections, no longer only `## Tasks`, placed before `## Tasks`; approved blocks stay byte-identical (same hash), unapproved tickets stay out. Section text is data: it never changes which tickets count as approved, and a heading in it is escaped so a downstream reader finds one `## Tasks` and only the approved tickets. A plan with an unclosed code fence → exit 1 (`unclosed code fence`) for `build-plan`. No new command, output line, exit code or record change.
v1.2 (minor, additive): a slug, or the folder or file of a plan reference, typed in another letter case than on disk (`exactWorkPath`, `work-folder-name` v1.1) → `refused: wrong letter case`, exit 3, on every platform, nothing written; this runs after the `bad slug` and `bad plan` shape checks. The real-path compare is exact, not case-insensitive. A slug or plan missing in every case keeps its old refusal. No new command, output line or exit code.
v1.1 (minor): a slug and a plan reference may be a new work folder name; `build-plan` prints a `plan:` line after `built` and after `file exists`, so a v1 reader that takes the first line and the approve lines after it must skip the `plan:` line. Legacy slugs, legacy `<slug>-build` plans and every v1 record read as before; the record format is unchanged. A future version that adds an `ev` or a key must keep this version's chain rule and status rule so an old record stays readable.
