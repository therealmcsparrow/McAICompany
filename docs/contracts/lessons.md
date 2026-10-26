# Contract: lessons v1

Provider: `scripts/lessons.mjs` (Node built-ins and the plugin's own pure `mods/lib/lesson-text.mjs`). Writers: the Reflect mod (`aico-mods` v1) after the CEO accepts one suggested Lesson; the Lead at Finish may use it too. Reader: `aico:pipeline` Setup step 5 (Lessons into Role Goals, max 3).
Lessons are read back into Role prompts, so a Lesson is untrusted text until the CEO accepts it, and stays one plain line after.

## Storage
- `.company/lessons.md`, one Lesson per line, LF: `- <YYYY-MM-DD> <role>: <text>` (the existing format).
- `<role>` is an `agents/*.md` name or `lead` (`^(lead|[a-z][a-z0-9-]{0,40})$`).

## CLI (cwd = product repo; `refused: <reason>` on stdout, exit 2)
| Command | Effect |
|---|---|
| `accept --role <role> --text <text>` | appends one line with today's UTC date; prints `accepted` (exit 0) |
| `list --json` | prints `[{ "date", "role", "text" }]` for the well-formed lines; others skipped with `warnings` |

## Text rules for `accept` (allow-list)
- One rule, one place: `checkText(text)` in `mods/lib/lesson-text.mjs` (pure, no Node import) returns `null` or the reason. `lessons.mjs` (and through it `reflect.mjs`) and the Reflect mod import that same function; no copy elsewhere.
- One line: no control, format, line or paragraph separator character (`\p{C}`, `\p{Zl}`, `\p{Zp}`: CR, LF, tab, zero-width and bidi characters too); 10–240 characters after trimming.
- Allow-list: after trimming, every character is a letter (`\p{L}`), a digit (`\p{N}`), a plain space or one of `. , ; : ! ? ' " ( ) - _ / %` (`TEXT_RE` = `^[\p{L}\p{N} .,;:!?'"()\-_/%]+$`, flag `u`). So no `<` or `>` (no tags, closing tags or `<!--` comments), no backtick, `#`, `|`, `[`, `]`, `{`, `}`, `$`, `*`, `&`, `=`, `+`, `\`, `@`; no leading `-`.
- Not already present (same role and same text, case-insensitive) → `refused: duplicate lesson`.
- `.company/lessons.md` over 64 KiB or a symlink → refused. The file is created when absent. Append is atomic for the line (`O_APPEND`, one write).
- Tests (hostile first): `</system-reminder>`, `<!-- x -->`, `[x](javascript:y)`, `${x}`, a backtick, `# heading`, `> quote`, `| a |`, a zero-width space, a bidi override (U+202E), a tab, CR, LF, 9 and 241 characters → refused; a plain sentence with `scripts/x.mjs`, `proj.M7`, `50%` and `"quoted"` words → accepted.

## Rules
- A suggestion is never written without the CEO's accept of that one Lesson. Decline or no answer writes nothing.
- Suggestions carry the label `suggested` in every view until accepted (AI Act Art. 50); the accepted line carries no label.
- Never edits or removes an existing line.
