# Contract: brainstorm-file v2

Provider: `aico:brainstorm` (the Lead) through `scripts/brainstorm.mjs`. Validator: `checkBrainstorm(text)` exported by `scripts/check.mjs` (Core). Consumers: `aico:brainstorm`, `aico:feature` (a built brainstorm's `## Summary` starts the brief), `aico:research`, `check.mjs` CI.
- **v1** = a brainstorm file without `format:` in its frontmatter (the shape in `skills/brainstorm/SKILL.md` at 0.10.0). It is read start to finish, passes `check.mjs`, and is **never rewritten or converted** (CEO, Brief Gate Q1). A reopened v1 file continues in v1.
- **v2** = `format: 2`. New major version because the body layout changes; approved by the CEO in the brainstorm Summary and at the Brief Gate. Rationale: `docs/adr/0009-brainstorm-format-2.md`.

## Files
- Brainstorm: `.company/<brainstorms|roadmap|nice-to-have|parked>/YYYY-MM-DD HH.MM - <Short Topic>.md` (name rule unchanged).
- Film script (only when `brainstorm.film_script` is `true`, `aico-settings` v1.1): `<same folder>/<same stem> - film.md`, frontmatter `kind: film`, `source: <brainstorm file name>`, `label: rendered from stored replies; no invented lines`. It moves with the brainstorm on close. `check.mjs` skips `kind: film` files except for that frontmatter.

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
- All passes of a round share its number: `src: R<n>`, idea IDs `I-<n>.<k>` and the reply-to checks count every pass of round `<n>`.

## Rules `checkBrainstorm` enforces (each error names the file and the rule)
1. No `format:` → v1: only the existing frontmatter checks; never an error for missing v2 sections.
2. `format:` present and not `2` → `unknown brainstorm format`.
3. The four sections, in order, nothing else at `## ` level. `## Digest` has `### Decisions`, `### Open threads` and `### Dissent`; `### Estimate` is required when `roles` includes `architect` (an `S|M|L, <range> d` line or `not estimated`).
4. Every Question line matches `- Q-<n> [blocking|nice-to-have] votes:<n> status:<open|answered|parked> — <text> — options: <a> | <b>[ | …] — default: <one of the options> — src: R<n>[ CEO]`. IDs unique.
5. Every Digest item ends with `src: R<n>` and round `<n>` exists under `## Rounds`.
6. A Decision quote appears byte for byte in a `**CEO:**` line of its source round. A Dissent quote appears byte for byte in one of that Role's non-`skip` replies (any pass) in its source round. A Role whose replies that round are all `skip` has no Digest entry from that round.
7. Every `answered` Question has exactly one Decision; every Decision names an existing Question.
8. Every round heading matches the heading rule above (`debate` without a style → `debate round needs a style`; another style → `unknown debate style`). Every reply heading matches the reply rule. `— full pass` replies appear only in a `debate: full_pass` round; `— crossfire` replies only in a debate round, zero or two of them; passes keep the order above (`pass out of order`).
- Limits: file ≤ 1 MiB, lines ≤ 4000 characters, anchored linear patterns only (proj.M1 to M4).

## Prompt inputs (round 2 and later)
`node brainstorm.mjs prompt <file> <role>` prints the round input block in `dispatch-prompt` v3.1 order: `Digest:` (the `## Digest` section as stored, identical for every Role), the Role's own last reply, `Others said:` (at most 5 one-line headlines, one per other Role, its first idea line cut to 120 characters), and `Full file: <absolute path>` (the Role opens it only when it needs to).
`prompt <file> <role> --pass full <round>` (full pass, `debate: full_pass` only) prints `Digest:`, the Role's own ideas-pass reply of `<round>`, `Other Roles:` with every other Role's ideas-pass reply of `<round>` verbatim (`skip` ones left out, malformed ones marked `(malformed)`), and `Full file:`. This pass reads more by design; it is the CEO's opt-in style.
`prompt <file> <role> --pass crossfire <round>` prints `Digest:`, the Role's own replies of `<round>`, and `Opponent:` with the other pair member's replies of `<round>` verbatim.

## Provider CLI (`scripts/brainstorm.mjs`, Node built-ins only, exit 2 on usage errors)
| Command | Does |
|---|---|
| `new <file> <topic> <roles> [mode]` | writes an empty v2 file |
| `parse <round> <role> [--pass ideas\|full\|crossfire]` (reply on stdin) | prints the parsed reply JSON (`brainstorm-reply` v1; pass rules there; default `ideas`), or `malformed: <reasons>` and exit 1 |
| `apply <file> <round> [--mode ideas\|moderated\|debate:crossfire\|debate:full_pass] [--pass ideas\|full\|crossfire]` (JSON on stdin: `{ replies: {role: text}, lead: text, dissent: [{role, quote}] }`) | appends the replies of that pass with every reply verbatim (a malformed one is stored, marked `(malformed)`, and listed on stdout for the Lead; never dropped), assigns `I-<round>.<n>` continuing the round's numbering, merges questions, updates Digest Threads, Estimate and Questions; validates with `checkBrainstorm`; writes atomically or refuses and changes nothing. `--mode` is given on the round's first apply (default `ideas`) and writes the heading; `--pass` defaults to `ideas`. `lead` may be empty on an apply that is not the round's last; a non-empty `lead` writes `**Lead:**` and closes the round's passes |
| `answer <file> <Q-id>` (answer on stdin) / `answer <file> <Q-id> --skip` | records the CEO's answer verbatim as a Decision, or the default as `(CEO skipped)`; sets `status:answered` |
| `ask <file> <text> --options <a\|b> --default <a> --tag <blocking\|nice-to-have>` | queues a mid-round CEO or Lead question for the next round |
| `queue <file>` | JSON `{ ask: [3 questions], next_up: question \| null }`: open only, blocking before nice-to-have, then votes, then oldest (CEO, Brief Gate Q2) |
| `prompt <file> <role> [--pass full\|crossfire <round>]` | the round input blocks above |
| `crossfire <file> <round>` | JSON pair `[roleA, roleB]` or `null` (debate rounds only, either style; see `brainstorm-reply` v1) |
| `film <file>` | writes the film script file; no model call; every line quotes a stored reply word for word |
| `check <file>` | runs `checkBrainstorm`; exit 1 with the errors |

Debate round flow (Lead, `aico:brainstorm`): `crossfire` style = ideas pass → `apply --mode debate:crossfire` → `crossfire` → pair dispatch → `apply --pass crossfire` (with `lead`). `full_pass` style = ideas pass → `apply --mode debate:full_pass` → `prompt --pass full` per Role → full-pass dispatch → `apply --pass full` → `crossfire` → pair dispatch → `apply --pass crossfire` (with `lead`). When `crossfire` prints `null`, the previous apply carries `lead` (or a final `apply` with empty `replies` and `lead` does).

## Error cases
- Malformed reply → stored verbatim with `(malformed)` and reported; the Lead may re-ask that Role once.
- `apply` result fails `checkBrainstorm` → `refused: <errors>`, file unchanged.
- `apply` for a round whose `**Lead:**` line exists → `refused: round <n> is closed`, file unchanged.
- `apply --pass full` on a round not headed `debate: full_pass`, or `--pass crossfire` on a round that is not a debate round → `refused: pass <p> not allowed in round <n>`, file unchanged.
- Duplicate questions: merged when their normalized text (lowercase, collapsed spaces, punctuation stripped) is equal, votes summed; the Lead may merge near-duplicates with `merge <file> <Q-keep> <Q-drop>` (votes summed, the dropped ID points to the kept one).
- An answered question never reaches `queue`.
