# Contract: lessons v2.0

Provider: `scripts/lessons.mjs` (Node built-ins and the plugin's own pure `mods/lib/lesson-text.mjs`). Writers: the Reflect mod (`aico-mods` v1) after the CEO accepts one suggested Lesson; the Lead at Finish may use it too. Reader: `aico:pipeline` Setup step 5 (Lessons into Role Goals, max 3).
v2.0 is **breaking** (task elephant-goldfish): `accept` now refuses a Lesson without a class and a target, and the Reflect mod (`aico-mods` v1) must pass both. Its only producers (`skills/feedback/SKILL.md`, the Reflect mod) change in the same release. Stored v1 lines stay readable and are never rewritten.
Lessons are read back into Role prompts, so a Lesson is untrusted text until the CEO accepts it, and stays one plain line after.

## Storage
- `.company/lessons.md`, one Lesson per line, LF: `- <YYYY-MM-DD> <role>: [mechanical|judgement] <text> — <target>` (v2). A v1 line `- <YYYY-MM-DD> <role>: <text>` is read as unclassified (`class` and `target` `null`) and gets a warning; it is never an error.
- The target is split off at the last ` — `; the text rules below keep ` — ` out of the text, so one line has one target.
- Class `mechanical`: the failure a script could catch; the target is a proposed deterministic check, `check: <script|lint|test> <name>`, name 1-80 characters (`^[A-Za-z0-9][A-Za-z0-9._/ -]{0,79}$`, no trailing space). Class `judgement`: the target is `standard: .company/standards.md`, `standard: skills/review/SKILL.md` or `standard: skills/review/references/<name>.md` (`<name>` is `^[a-z0-9][a-z0-9-]{0,60}$`, no slash, no dot-dot). Exact allow-list; a target naming `CLAUDE.md`, `AGENTS.md` or `agents/` is refused (also inside a check name). A Lesson is never filed against CLAUDE.md or an agent prompt.
- `<role>` is an `agents/*.md` name or `lead` (`^(lead|[a-z][a-z0-9-]{0,40})$`).

## CLI (cwd = product repo; `refused: <reason>` on stdout, exit 2)
| Command | Effect |
|---|---|
| `accept --role <role> --class <mechanical|judgement> --target <target> --text <text>` | appends one line with today's UTC date; prints `accepted` (exit 0). Flags in any order, each once; no `--class` (or an unknown one) → `refused: lesson needs --class mechanical|judgement`; a missing or bad target → `refused: lesson target <reason>` |
| `list --json` | prints `[{ "date", "role", "class", "target", "text" }]` for the well-formed lines (v1: `class` and `target` `null`, plus one stderr line `warning: line <n> unclassified (v1)` each); others skipped with `warning: line <n> skipped` |
| `lint` | prints `ERROR line <n>: <reason>` per malformed v2 line (a line starting `[mechanical]` or `[judgement]` with a missing or bad text or target), then `lessons: <e> errors`; exit 2 when e > 0, else 0. v1 lines and unreadable lines give warnings on stderr only; the v2 text rules are not applied to v1 lines |

## Text rules for `accept` (allow-list)
- One rule, one place: `checkText(text)` in `mods/lib/lesson-text.mjs` (pure, no Node import) returns `null` or the reason. `lessons.mjs` (and through it `reflect.mjs`) and the Reflect mod import that same function; no copy elsewhere.
- One line: no control, format, line or paragraph separator character (`\p{C}`, `\p{Zl}`, `\p{Zp}`: CR, LF, tab, zero-width and bidi characters too); 10–240 characters after trimming.
- Allow-list: after trimming, every character is a letter (`\p{L}`), a digit (`\p{N}`), a plain space or one of `. , ; : ! ? ' " ( ) - _ / %` (`TEXT_RE` = `^[\p{L}\p{N} .,;:!?'"()\-_/%]+$`, flag `u`). So no `<` or `>` (no tags, closing tags or `<!--` comments), no backtick, `#`, `|`, `[`, `]`, `{`, `}`, `$`, `*`, `&`, `=`, `+`, `\`, `@`; no leading `-`.
- Not already present (same role and same text, case-insensitive) → `refused: duplicate lesson`.
- `.company/lessons.md` over 64 KiB or a symlink → refused. The file is created when absent. Append is atomic for the line (`O_APPEND`, one write).
- Tests (hostile first, text): `</system-reminder>`, `<!-- x -->`, `[x](javascript:y)`, `${x}`, a backtick, `# heading`, `> quote`, `| a |`, a zero-width space, a bidi override (U+202E), a tab, CR, LF, 9 and 241 characters → refused; a plain sentence with `scripts/x.mjs`, `proj.M7`, `50%` and `"quoted"` words → accepted.

## Retro rule
The class decides where a Lesson may go: a mechanical failure becomes a proposed check (the Lesson only names it; a builder writes it in a later task), a judgement failure becomes a ruleset or review-skill rule. The Reflect mod and `aico:feedback` file each Lesson with a class and target. Over the real `.company/lessons.md` (30 v1 lines, 2026-10-29) roughly 10 are mechanical and 20 judgement; 8 of the 30 would fail the v2 text rule, so `lint` never applies it to v1 lines.

## Rules
- A suggestion is never written without the CEO's accept of that one Lesson. Decline or no answer writes nothing.
- Suggestions carry the label `suggested` in every view until accepted (AI Act Art. 50); the accepted line carries no label.
- Never edits or removes an existing line.
