# Contract: lessons v1

Provider: `scripts/lessons.mjs` (Node built-ins only). Writers: the Reflect mod (`aico-mods` v1) after the CEO accepts one suggested Lesson; the Lead at Finish may use it too. Reader: `aico:pipeline` Setup step 5 (Lessons into Role Goals, max 3).
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
- One line: no CR, LF, tab or other control character; 10–240 characters after trimming.
- No leading `-`, `#`, `>` or `|`; no backtick; no `<` followed by a letter (no tags).
- Not already present (same role and same text, case-insensitive) → `refused: duplicate lesson`.
- `.company/lessons.md` over 64 KiB or a symlink → refused. The file is created when absent. Append is atomic for the line (`O_APPEND`, one write).

## Rules
- A suggestion is never written without the CEO's accept of that one Lesson. Decline or no answer writes nothing.
- Suggestions carry the label `suggested` in every view until accepted (AI Act Art. 50); the accepted line carries no label.
- Never edits or removes an existing line.
