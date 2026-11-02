# Contract: voice-profile v1

Provider: `scripts/voice-profile.mjs` (read-only; reads sources, writes nothing). Imports: `node:url` and `./slop-scan.mjs` only. No network module, no `fetch`, no child process (a test checks the imports). Uses `slop-scan` v1 `wordTerms()`, `walk`, `readInput`, `mask`, `paragraphs`, `countWords`, so the bounds cannot drift. Consumers: writing Roles, the CEO. Line 2 of the provider holds `// Voice profile (contract: docs/contracts/voice-profile.md v1). …` for `contract-index` v1.

## CLI
`voice-profile [--json] [--voice-line <text>]` (cwd = product root). `main(args, env)` takes `env.cwd`, `env.log` (an array that receives each path read, for tests) and `env.terms` (replaces the catalog word terms, for tests), and returns `{ code, stdout, stderr }`. `buildProfile(texts, opts)` and `STOP_WORDS` are exported too.

## Sources
`README.md` at the root, plus the `.md` files under `documentation/` if that folder holds at least one readable `.md` with a word in it, else under `docs/`. Same walk bounds and checks as `slop-scan` (depth 6, 2000 files, 1 MiB per file, UTF-8); dot-named entries and links are never entered. A source that is a link, too large, not UTF-8 or unreadable, or a walk cut, is skipped and counted, never fatal. A symlink or hard link met in a walk is left out and counted when the shared `walk` reports it as `links`. At most 16 MiB of source text is held; sources past that are skipped and counted once. Never reads `.company/`, the home folder, transcripts or Handoffs. The project voice line comes in only as `--voice-line`. Learned fresh on every run, written nowhere.

## Output
Text:
```
voice profile: <k> files, <w> words
skipped: <n>                       (only when n > 0)
sentence length: mean <m>, median <p50>, p90 <p90>
person: I <a>%, we <b>%, you <c>%
tone: contractions <x> per 1000 words, questions <y>%, exclamations <z>%
preferred terms: <list>
avoided terms: <list>
```
Lists are comma separated; an empty list prints `none`. All figures `toFixed(1)`.

`--json`: `{ "v": 1, "source": "docs", "files", "words", "skipped", "sentence": { "mean", "p50", "p90" }, "person": { "i", "we", "you" }, "tone": { "contractions", "questions", "exclamations" }, "preferred": [], "avoided": [] }`; figures are numbers, `Number(x.toFixed(1))`. Two runs on the same sources are byte-equal.

## Measures
On masked text, a sentence ends at `.`, `!` or `?` before whitespace or end of text, at a blank line, or at the end of a heading (ATX or setext) or list item at any indent; its length is in `countWords` tokens. `p50` and `p90` are nearest rank on the ascending lengths (`ceil(p/100*n)`-th). Person bases: case-insensitive whole-token counts of `I`, `me`, `my`, `mine`; `we`, `us`, `our`, `ours`; `you`, `your`, `yours`; each percentage is of those three counts together. Questions and exclamations: percentage of sentences ending in `?` and `!`. Contractions: tokens ending in `n't`, `'re`, `'ve`, `'ll`, `'d` or `'m`, straight or curly (`'s` is left out, mostly possessive). A figure with a zero base is `0.0`.

Preferred terms: lowercase words of 4 to 30 letters, outside code, seen in lowercase in 2 or more source files, never seen capitalized past the first word of a sentence, minus `wordTerms()` and minus `STOP_WORDS` (a fixed list of at most 200 English function words such as `that`, `with`, `this`, `your`); ordered by total count descending, then code point; first 15. Avoided terms: `wordTerms()` entries with no hit in the sources (whole word or phrase, case-insensitive); code point order; first 15. The profile holds style features only: no name and no sentence from a source reaches the output. Chunks of text holding `@`, `://`, `www.`, a `/` or `\`, or a `.` or `:` between two letters or digits (a path, scheme-less address, bare domain, IP or host with port) are left out of term counting, a quote or possessive `'s` is stripped before the capital test, and a possessive stem is never preferred. A term is seen when it occurs in the joined text of `slop-scan` v1 `paragraphs` (one space between wrapped lines, paragraphs joined by a newline), searched in each source on its own, so a phrase wrapped over two lines counts as seen and a phrase split by a blank line, list item, fence or file does not.

## Fallback
Zero words across all sources (no README and no docs folder, or only empty or skipped files): text `voice profile: no doc text in README or docs folder; using the project voice line: <text>` (or `; no voice line given`), JSON `{ "v": 1, "source": "fallback", "voice": "<text>" | null }`, exit 0.

## Exit codes
- 0: a profile or the fallback printed.
- 2: bad usage only: unknown flag or argument (`ERROR bad usage: …`), or a `--voice-line` value that does not fully match `^(clear|bold|technical)( \+ (clear|bold|technical))*$` or is missing (`ERROR bad voice line`). One stderr line, nothing on stdout, the value never echoed. A valid value is printed only in the fallback line and the JSON `voice` field.

Tests: `scripts/voice-profile.test.mjs`.
