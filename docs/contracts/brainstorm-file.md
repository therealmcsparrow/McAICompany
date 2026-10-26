# Contract: brainstorm-file v2

Provider: `aico:brainstorm` (the Lead) through `scripts/brainstorm.mjs`. Validator: `checkBrainstorm(text)` exported by `scripts/check.mjs` (Core). Consumers: `aico:brainstorm`, `aico:feature` (a built brainstorm's `## Summary` starts the brief), `aico:research`, `check.mjs` CI.
- **v1** = a brainstorm file without `format:` in its frontmatter (the shape in `skills/brainstorm/SKILL.md` at 0.10.0). It is read start to finish, passes `check.mjs`, and is **never rewritten or converted** (CEO, Brief Gate Q1). A reopened v1 file continues in v1.
- **v2** = `format: 2`. New major version because the body layout changes; approved by the CEO in the brainstorm Summary and at the Brief Gate. Rationale: `docs/adr/0009-brainstorm-format-2.md`; constant prompt and input files: `docs/adr/0013-brainstorm-constant-prompt.md`; crossfire folded into the next round (Fix round 4): `docs/adr/0014-crossfire-folded-into-next-round.md`.

## Files
- Brainstorm: `.company/<brainstorms|roadmap|nice-to-have|parked>/YYYY-MM-DD HH.MM - <Short Topic>.md` (name rule unchanged).
- Film script (only when `brainstorm.film_script` is `true`, `aico-settings` v1.1): `<same folder>/<same stem> - film.md`, frontmatter `kind: film`, `source: <brainstorm file name>`, `label: rendered from stored replies; no invented lines`. It moves with the brainstorm on close. `check.mjs` skips `kind: film` files except for that frontmatter.
- Round input files (local, never committed): `.company/brainstorm-input/<run>/<role>.md`, see "Round input". They are views written by the script, not brainstorm files: `check.mjs` never scans them, Close never moves them, `film` never reads them.

## v2 layout
Frontmatter: `topic`, `started`, `status` (`open | built | roadmap | nice-to-have | parked`), `roles`, `format: 2`, optional `mode` (`ideas | debate | moderated`).
Body: exactly these `## ` sections, in this order, and no others: `## Summary`, `## Digest`, `## Questions`, `## Rounds`.

```markdown
## Summary
(written at close)
## Digest
### Decisions
- D-1 — Q-2 — "<the CEO's answer, byte for byte>" — src: R1
- D-2 — Q-4 — default: <option> (CEO skipped) — src: R2
- D-3 — none — "<a CEO ruling that answers no asked question, byte for byte>" — src: R2
### Open threads
- O-1 — <one line> — ideas: I-1.2, I-1.4 — src: R1
### Dissent
- Ava (architect) — "<the Role's own words, byte for byte from its reply>" — src: R2
### Threads
- I-1.2 ← Ren (writer) challenge: "<the reply-to text>" — src: R2
### Estimate
- M, 3–5 d — src: R2
## Questions
- Q-1 [blocking] votes:3 status:open — <one sentence> — options: <a> | <b> | <c> — default: <a> — src: R1
## Rounds
### Round 1 — ideas
#### Ava (architect)
<the reply, verbatim>
#### Ren (writer)
skip
**Lead:** <the Lead's ideas summary, one paragraph>
**CEO:** <the CEO's reply, verbatim>
### Round 2 — debate: full_pass
#### Ava (architect)
<ideas-pass reply, verbatim>
#### Ren (writer)
<ideas-pass reply, verbatim>
#### Ava (architect) — full pass
<full-pass reply, verbatim>
#### Ren (writer) — full pass
<full-pass reply, verbatim>
#### Ren (writer) — crossfire
<crossfire reply, verbatim>
#### Ava (architect) — crossfire
<crossfire reply, verbatim>
**Lead:** <summary>
**CEO:** <the CEO's reply, verbatim>
```

### Round headings and passes
- A round heading is `### Round <n> — <mode>`, `<mode>` one of `ideas`, `moderated`, `debate: crossfire`, `debate: full_pass`. A debate round always names its style: the resolved `brainstorm.debate` of the run (`aico-settings` v1.1), fixed for that round. Mode and style may differ between rounds (the CEO's "Change mode", or a later run with other settings).
- Reply headings: `#### <Name> (<role>)` for the ideas pass (or a moderated turn), `#### <Name> (<role>) — full pass`, `#### <Name> (<role>) — crossfire`.
- Pass order inside a round: ideas-pass replies, then full-pass replies (only in `debate: full_pass`, at most one per Role), then crossfire replies (only in a debate round, none or exactly two: the pair from `crossfire`), then `**Lead:**`, then `**CEO:**`.
- Fix round 4: `apply` writes crossfire replies only in a `debate: full_pass` round; a `debate: crossfire` round holds only ideas-pass replies (its challenge is answered in the next round, "Round input" `Challenge to you:`). A file written before that, with two crossfire replies in a `debate: crossfire` round, stays valid (rule 8 is unchanged).
- All passes of a round share its number: `src: R<n>`, idea IDs `I-<n>.<k>` and the reply-to checks count every pass of round `<n>`.
- The CEO reply of a round is its `**CEO:**` line plus the plain lines after it (later `answer` calls add lines there).

### Stored form of a reply
"Verbatim" in the layout means the stored form below; Dissent quotes (rule 6) are taken from it.
- Valid reply: the text as sent, line endings made LF, surrounding whitespace trimmed. A reply that is valid only through "Lenient labels" (`brainstorm-reply` v1) is stored as sent too: the stray label or bullet stays in the stored text.
- `Skip` (alone, any letter case, `brainstorm-reply` v1) is stored as `skip`. This is the one normalised body; rule 6 compares with `skip`.
- Malformed reply: the first body line is `(malformed)` (never in the heading), then the text with control characters replaced by `?`, cut at 4 KiB with a last line `(truncated)`, each line cut at 1000 characters. A line starting `#`, `**Lead:**` or `**CEO:**` is stored with a `> ` prefix, so a reply can never forge file structure and the file stays valid.
- Idea IDs are never written into a stored reply by the script. The ID-annotated "shown form" (below) exists only in round input files, so rule 6 quotes and `film` lines stay byte for byte.

## Rules `checkBrainstorm` enforces (each error names the file and the rule)
1. No `format:` → v1: only the existing frontmatter checks; never an error for missing v2 sections.
2. `format:` present and not `2` → `unknown brainstorm format`.
3. The four sections, in order, nothing else at `## ` level. `## Digest` has `### Decisions`, `### Open threads` and `### Dissent`; `### Estimate` is required when `roles` includes `architect` (an `S|M|L, <range> d` line or `not estimated`).
4. Every Question line matches `- Q-<n> [blocking|nice-to-have] votes:<n> status:<open|answered|parked> — <text> — options: <a> | <b>[ | …] — default: <one of the options> — src: R<n>[ CEO]`. IDs unique.
5. Every Digest item ends with `src: R<n>` and round `<n>` exists under `## Rounds`.
6. A Decision quote appears byte for byte in the CEO reply (`**CEO:**` line and the plain lines after it) of its source round. A Dissent quote appears byte for byte in one of that Role's non-`skip` replies (any pass) in its source round. A Role whose replies that round are all `skip` has no Digest entry from that round. A Decision links `Q-<n>` or `none`; a `none` Decision is a quote found in its round's **CEO:** line, never `(CEO skipped)`. Rule 7 counts no `none` Decision for any question.
7. Every `answered` Question has exactly one Decision; every Decision names an existing Question.
8. Every round heading matches the heading rule above (`debate` without a style → `debate round needs a style`; another style → `unknown debate style`). Every reply heading matches the reply rule. `— full pass` replies appear only in a `debate: full_pass` round; `— crossfire` replies only in a debate round, zero or two of them; passes keep the order above (`pass out of order`).
- Limits: file ≤ 1 MiB, lines ≤ 4000 characters, anchored linear patterns only (proj.M1 to M4).
- Round input files add no rule: they are not brainstorm files.

## Round input (every round and pass)
A Role's dispatch prompt is **byte-identical for the whole run**: every round, every pass, every re-ask (`dispatch-prompt` v3.1, "Brainstorm"). Everything that changes is in that Role's **input file**, which `stage` writes and the Role reads first. Reason: the host puts the prompt before the ~13k-token Role block; an identical prompt reuses the cached block, a changed one rewrites it (Spike S2; replay `25-ai-data-engineer.md`).
Fix round 4: the input file is written to the cache on every dispatch, so it is kept lean (T15b: 3.7–4.2 KiB in round 2, more than the old flow's whole 2.9 KiB file). Changes against Fix round 3 are marked "(FR4)".

### Path and lifetime
- `<repo root>/.company/brainstorm-input/<run>/<role>.md`, where `.company/` is the folder that holds the brainstorm file's folder (the file must sit in one of the four brainstorm folders, else `refused: <file> is not in a brainstorm folder`). `<run>` = `brainstorm-<YYYYMMDD-HHMM>` from the file name's stamp `YYYY-MM-DD HH.MM` (the ledger's run name, `token-ledger` v1); `<role>` is a roster slug. Neither part ever comes from free text. A file name without that stamp → `refused: no time stamp in the file name`.
- The path is the same for a Role in every round and pass, so the prompt naming it never changes. On a reopen (or a move between the four folders) the stamp, and so the path, stays the same.
- One file per Role, not one shared file: each Role reads only its own material, and a shared prompt would not share a cache anyway (the Role block after it differs per Role).
- Never committed: `stage` creates `.company/brainstorm-input/.gitignore` with the one line `*` when it is missing. The folder is outside the four brainstorm folders.
- Written only by the script: LF, atomically (temp file plus rename). `stage` first removes every `<slug>.md` in `<run>/`, so a Role that is not staged for this pass has no file and nothing stale can be read.
- Removed by `clean` at Close (the Lead runs it); stale folders after a crash are local, ignored and removed by the next `clean` of that run.

### Layout (labels are exact; each label is a line of its own, its content follows; an empty block prints `(none)`; an optional label is left out entirely when it does not apply)
| Label | Content |
|---|---|
| `Round: <n>` | the round being played |
| `Pass: ideas \| full \| crossfire` | the pass (`ideas` also for a moderated turn) |
| `Topic:` | the frontmatter `topic`, one line |
| `Read also:` (optional) | the absolute path of `.company/project.md`, only when that file exists and this Role has no stored reply in the file yet (its first turn) |
| `Summary:` (optional) | the stored `## Summary` paragraph, only when one was written (a reopened file) |
| `Re-ask:` (optional) | only for `stage --reask`: the parse reasons of the Role's malformed reply, joined with `; ` |
| `Your malformed reply:` (optional) | only for `stage --reask`: that stored reply without its `(malformed)` line, first 1000 characters |
| `Questions:` | (FR4) answered questions first, the 4 with the highest IDs, in ID order: `- Q-<n> answered: <text> → "<the Decision's quote>"` (quote cut at 160 characters on a word boundary, then `…`) or `→ default: <option> (CEO skipped)`; then open questions in `queue` order, at most 4: `- Q-<n> open: <text>`. Parked questions are left out. `<text>` is cut at 100 characters on a word boundary, then `…`. (Fix round 3: 12 answered, 8 open, text 120, quote 300.) |
| ~~`Digest:`~~ | (FR4) removed from every pass. Decisions are under `Questions:`, the ideas under `Others said:`; Open threads, Dissent, Threads and Estimate stay in the brainstorm file for the Lead and the CEO. If the reply quality drops, Open threads (latest 3) is the first block to add back. |
| ideas pass: `Your last ideas:` | (FR4, was `Your last reply:`) the idea lines of the Role's latest valid, non-skip reply (any round, any pass), one per line as `- <idea>`, cut at 100 characters on a word boundary, then `…`. No ID, no label, no `Risk:`. For the architect one more line `- your estimate was <S\|M\|L, <low>–<high> d>` when that reply had one. Reason: 4 of 9 malformed first replies in T15b copied the `I-<r>.<k>:` labels of the old block |
| ideas pass: `Challenge to you:` (optional) | (FR4) only when the previous round is a `debate: crossfire` round and its pair (the `crossfire` selection, "Crossfire" in `brainstorm-reply` v1, computed on the closed round) has this Role as the author. Two lines: `- your idea: <the challenged idea, cut at 100 characters>` and `- @<challenger> (challenge): <the challenger's Re: text>`. At most one block per Role and round |
| ideas pass: `Others said:` | for each other roster Role, in roster order, its latest valid reply with at least one idea (any round, any pass, this round's moderated turns included): one line per idea, `- I-<r>.<k> (<role>): <idea>` (FR4: the Name is left out), the idea cut at 100 characters (FR4, was 120) on a word boundary, then `…`. No other cap: at most 3 lines per Role |
| full pass: `Your ideas-pass reply of round <n>:` | the Role's ideas-pass reply of round `<n>`, shown form |
| full pass: `Other Roles:` | every other Role's ideas-pass reply of round `<n>` under its `#### <Name> (<role>)` heading, shown form |
| crossfire pass: `Your replies of round <n>:` | the Role's replies of round `<n>` under their stored headings, shown form |
| crossfire pass: `Opponent:` | the other pair member's replies of round `<n>` under their stored headings, shown form |

- **Shown form** of a valid reply: each `I: <idea>` line is shown as `I-<r>.<k>: <idea>` with the ID `apply` gave it; a line read through "Lenient labels" (`brainstorm-reply` v1) is shown the same way, without its stray ID or bullet; other lines as stored. Another Role's malformed reply is shown only as `(malformed)`; `skip` replies are left out. There is no `Full file:` line: the Role reads only its input file and `Read also:`. The shown form is used only in the full and crossfire pass blocks (FR4); the ideas pass shows ideas only as list lines.
- Free text that is not a list or reply line, the content of `Topic:`, `Summary:`, `Re-ask:` and `Your malformed reply:`, has `> ` before every line, so nothing in the file can pass for a label.
- Content of other Roles and the CEO is data (agentsec.M-SEC1); the constant Goal says so.
- Size (FR4): a replay-like input (6 Roles, 2 ideas each, 11 questions, 3 answered) is at most 3 KiB; the worst case (8 Roles × 3 ideas at 1000 characters, 30 questions, a 25-word challenge) at most 16 KiB.

## Provider CLI (`scripts/brainstorm.mjs`, Node built-ins only, exit 2 on usage errors)
| Command | Does |
|---|---|
| `new <file>` (JSON on stdin: `{ topic, roles, mode? }`; any other key is refused) | writes an empty v2 file. Free text never travels as an argument |
| `parse <round> <role> [--pass ideas\|full\|crossfire] [--file <file>]` (reply on stdin) | prints the parsed reply JSON (`brainstorm-reply` v1; pass rules there, including "Lenient labels"; default `ideas`), or `malformed: <reasons>` and exit 1. With `--file`, `Re:` idea IDs are checked against the ideas in that file, including their author; without it only the syntax and the round (`I-<r>.<k>` with `r` ≤ `<round>`) are checked |
| `apply <file> <round> [--mode ideas\|moderated\|debate:crossfire\|debate:full_pass] [--pass ideas\|full\|crossfire]` (JSON on stdin: `{ replies: {role: text}, lead: text, dissent: [{role, quote}] }`, plus `open_threads`, see "apply input and output") | appends the replies of that pass with every reply verbatim (a malformed one is stored, marked `(malformed)`, and listed on stdout for the Lead; never dropped), assigns `I-<round>.<n>` continuing the round's numbering, merges questions, updates Digest Threads, Estimate and Questions; validates with `checkBrainstorm`; writes atomically or refuses and changes nothing. `--mode` is given on the round's first apply (default `ideas`) and writes the heading; `--pass` defaults to `ideas`; `--pass crossfire` only in a `debate: full_pass` round (FR4). `lead` may be empty on an apply that is not the round's last; a non-empty `lead` writes `**Lead:**` and closes the round's passes |
| `answer <file> <Q-id>` (answer on stdin) / `answer <file> <Q-id> --skip` | records the CEO's answer verbatim as a Decision, or the default as `(CEO skipped)`; sets `status:answered` (rules in "answer") |
| `decide <file>` (ruling on stdin) | records a CEO ruling that answers no queued question as `- D-<k> — none — "<ruling>" — src: R<round>`, with the same text and CEO-line rules as `answer` ("answer"); no question changes status |
| `ask <file>` (JSON on stdin: `{ text, options: [..], default, tag: blocking\|nice-to-have, ceo? }`; any other key is refused) | queues a mid-round CEO or Lead question for the next round. `src:` is the latest round (`R1` before any round); `"ceo": true` writes `src: R<n> CEO`, without it `src: R<n>`. Text one line of 1 to 300 characters; 2 to 6 options without `\|`; the default is one of them |
| `merge <file> <Q-keep> <Q-drop>` | `Q-drop` must be open; `Q-keep` must be open or answered (a restatement of an answered question is merged into it, so it never returns). Votes summed into `Q-keep`, its status unchanged; the dropped line becomes `votes:0 status:parked — merged into Q-<keep> (<old text>)` |
| `queue <file>` | JSON `{ ask: [3 questions], next_up: question \| null, answered: [{ id, text }] }`: `ask`/`next_up` open only, blocking before nice-to-have, then votes, then oldest (CEO, Brief Gate Q2); `answered` lists every answered question in ID order, for the Lead's duplicate check |
| `stage <file> <round> [--pass ideas\|full\|crossfire] [--roles <slug>,<slug>] [--reask <role>]` | writes the round input files ("Round input") and prints JSON `{ run, files: { "<role>": "<absolute path>" } }`. Staged Roles: ideas pass → `--roles` or every roster Role; full pass → `--roles` or every roster Role; crossfire → exactly the computed pair (`--roles` refused), `debate: full_pass` rounds only (FR4). `--reask <role>` → ideas pass, that Role only. Never changes the brainstorm file |
| `prompt <file> <role> [--pass full\|crossfire <round>]` | prints the input file text `stage` would write for that Role (ideas pass: for the latest round while it is open, else the next round); writes nothing |
| `clean <file>` | removes `.company/brainstorm-input/<run>/` of that file; prints `cleaned <run>` (also when there was nothing to remove) |
| `crossfire <file> <round>` | JSON pair `[roleA, roleB]` or `null` (debate rounds only, either style; see `brainstorm-reply` v1). `roleA` is the challenger, `roleB` the idea's author (role slugs). Also `null` when the round does not exist, already has crossfire replies, or is closed, so a played pass is never dealt twice. In a `debate: crossfire` round the Lead uses it only for the `dissent` entry (FR4); `stage` computes the same selection on the closed previous round for `Challenge to you:`, without these `null` rules |
| `film <file>` | writes the film script file; no model call; every line quotes a stored reply word for word |
| `check <file>` | runs `checkBrainstorm`; exit 1 with the errors |

### stage rules
- Round: the ideas pass stages the next round (latest + 1, or 1 in an empty file) or the latest round while it is open (moderated turns, re-asks). The full and crossfire passes stage the latest round, open, headed `debate: full_pass` (FR4: the crossfire pass no longer stages a `debate: crossfire` round). Anything else → `refused: round <n> cannot be staged`.
- `Challenge to you:` (FR4): only on an ideas pass that stages round `<m>` = latest + 1 while round `<m>`−1 is a closed `debate: crossfire` round; the challenger's `Re:` text comes from its stored valid reply. A re-ask or moderated turn in round `<m>` shows the same block to the same Role.
- `--reask <role>`: the Role's latest reply in round `<round>` must be a malformed ideas-pass reply, else `refused: <role> has no malformed reply in round <n>`. The reasons come from parsing the stored text again (`parse --file` rules).
- A `--roles` slug outside the roster → `refused: <slug> is not in the roster`. `--pass crossfire` with no pair → `refused: no crossfire pair in round <n>`.
- File system: the run folder and `.gitignore` are created when missing; a symlink or any entry other than `<slug>.md` and the script's own temp files in `<run>/` → `refused: unexpected entry in <run>`, nothing written. Paths are built from the checked stamp and roster slugs only, and must resolve inside `.company/brainstorm-input/`.
- `clean` deletes only `<slug>.md` files and the script's temp files in `<run>/`, then the folder; any other entry or a symlink → `refused: unexpected entry in <run>`, nothing deleted. It never touches `.gitignore` or other runs.

### apply input and output
- Keys allowed on stdin: `replies`, `lead`, `dissent`, `open_threads`; any other key → `refused: unknown key <k>`.
- `replies` keys are `"<Name> (<role>)"`, the `####` heading text. A bare role slug works only when the file already has a name for that Role. A Role outside `roles` is refused; a different name for a Role already named in the file → `refused: name clash: <role> is <known>, not <name>`. `dissent[].role` follows the same rule; `quote` is one line of 1 to 1000 characters.
- `open_threads: [{ text, ideas }]` writes one `- O-<k> — <text>[ — ideas: <ids>] — src: R<round>` line per entry, `O-<k>` numbered on. `text` is one line of 1 to 300 characters; `ideas` is 0 to 10 idea IDs that exist in the file or this apply. It is the only writer of `### Open threads`.
- A non-empty `lead` that contains `Open:`: the text from `Open:` to the end of that sentence names at least one `Q-<n>` or `O-<n>` of the file, or reads `Open: none`, or the same apply carries `open_threads`; else `refused: lead Open: names no Q-<n> or O-<n>; add open_threads or ask`, file unchanged.
- Crossfire pass (`debate: full_pass` rounds only): the replies come only from the computed pair, both in one apply (a `Skip` counts), stored challenger first.
- Stdout on success: JSON `{ ideas: [<new idea IDs>], malformed: [{ key, reasons }] }`.

### answer
- Writes into the latest round, which must have its `**Lead:**` line (else `refused: round <n> has no **Lead:** line yet`). The question must be open.
- The answer is one line of at most 1000 characters, without control characters, not starting with `#`, `**Lead:**` or `**CEO:**`; surrounding whitespace is trimmed. "Verbatim" means this trimmed text, in the Decision quote and the CEO reply alike.
- The round's first answer writes `**CEO:** <answer>` (`**CEO:** (skipped)` with `--skip`). Later answers add the answer as a plain line of the same CEO reply, unless that text is already in it; a later `--skip` adds no line.
- The Decision's `src:` is that round.
- A Decision links `Q-<n>` only when the CEO answered that question; a ruling that answers no asked question goes through `decide` (link `none`). Never link by position or best fit.

Round flow (Lead, `aico:brainstorm`): every dispatch is preceded by `stage` for exactly the Roles dispatched, with the Role's constant prompt. Ideas or moderated round = `stage` → dispatch → `apply` (re-ask: `stage --reask` → dispatch → `apply`). `crossfire` style (FR4, folded) = ideas pass → `apply --mode debate:crossfire` (`lead` empty) → re-asks → `crossfire` → a final `apply` with empty `replies`, `lead`, and, when a pair exists, a `dissent` entry quoting the challenger's `Re:` text; no pair dispatch. The author answers in the next round's ideas pass (`Challenge to you:`). `full_pass` style = ideas pass → `apply --mode debate:full_pass` → `stage --pass full` → full-pass dispatch → `apply --pass full` → `crossfire` → `stage --pass crossfire` → pair dispatch → `apply --pass crossfire` (with `lead`). When `crossfire` prints `null`, the previous apply carries `lead` (or a final `apply` with empty `replies` and `lead` does). Before the form: the Lead's duplicate check (`queue` `answered`, then `merge`). At Close: `clean`.

## Error cases
- Malformed reply → stored verbatim with `(malformed)` and reported; the Lead may re-ask that Role once. A re-ask works in the ideas pass only: a second block for that Role is appended and idea numbering never shifts. In the full and crossfire passes one reply per Role is allowed, so a second one → `refused: <Name> (<role>) already replied in pass <p> of round <n>`. A reply valid only through "Lenient labels" is not malformed and gets no re-ask (FR4).
- `apply` result fails `checkBrainstorm` → `refused: <errors>`, file unchanged.
- `apply` for a round whose `**Lead:**` line exists → `refused: round <n> is closed`, file unchanged.
- `apply --pass full` on a round not headed `debate: full_pass`, or `--pass crossfire` on a round not headed `debate: full_pass` (FR4, was: not a debate round) → `refused: pass <p> not allowed in round <n>`, file unchanged.
- Duplicate questions: merged automatically when their normalized text (lowercase, collapsed spaces, punctuation stripped) equals any existing question's, whatever its status (votes summed, status unchanged, so an exact restatement of an answered question never reopens it). Restatements in other words are prevented by the `Questions:` block of the input file and caught by the Lead with `merge <file> <Q-keep> <Q-drop>` (keep may be answered). The script does no fuzzy matching: the replay's restatements share too few words for a fixed rule.
- An answered question never reaches `queue` `ask` or `next_up`.
- Files: CRLF files are read and written back with LF. Every command except `new` and `check` refuses, untouched, a v1 file (it continues in the 0.10.0 flow), a `kind: film` file, and a file that already fails `checkBrainstorm`.
- Output: refusals go to stderr as `refused: …` with exit 1; usage errors exit 2; `parse` prints `malformed: <reasons>` to stdout with exit 1.
