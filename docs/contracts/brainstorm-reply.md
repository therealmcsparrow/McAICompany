# Contract: brainstorm-reply v1

Provider: every Role dispatched by `aico:brainstorm` (the template is in its Goal line). Consumer: `scripts/brainstorm.mjs parse` and `apply` (`brainstorm-file` v2).

## Template (one item per line, prose in the run's `Language:`, labels in English)
```
I: <idea, one line>                       (0 to 3 lines)
Risk: <the biggest risk or cost, one line>   (exactly 1, unless Skip)
Q [blocking]: <one sentence> | options: <a> / <b>[ / <c>] | default: <a>
Q [nice-to-have]: <one sentence> | options: <a> / <b> | default: <a>   (0 to 2 Q lines in total)
Re: @<role> on I-<round>.<n>: agree|challenge|build-on — <at most 25 words>   (0 or 1)
Estimate: S|M|L, <low>–<high> d           (architect: required every round; others: never)
```
- `Skip` alone on the only line = nothing new this round (AC11). It is recorded in `## Rounds` and gets no Digest entry. Not an error. Any letter case is accepted (`Skip`, `skip`); it is stored as `skip` (`brainstorm-file` v2, "Stored form of a reply").
- At most 150 words in total (crossfire replies: about 50).
- The Role gives no IDs; `apply` numbers ideas `I-<round>.<n>` across the round in roster order.

## Passes (`parse --pass`, default `ideas`)
The template above is the **ideas** pass (also moderated turns). Two debate passes differ only here:
| Pass | When | Differs from the ideas pass |
|---|---|---|
| `full` | `debate: full_pass` rounds, after the ideas pass is applied | `Risk:` 0 or 1; `Re:` 1 to 3 lines (each on an idea of this round or earlier); no `Estimate:`; at most 100 words |
| `crossfire` | debate rounds of either style | no `Estimate:`; about 50 words (hard limit 80) |
`Skip` is allowed in every pass. The architect's round estimate comes from its ideas-pass reply only.

## Parse result (`parse` stdout)
`{ pass, skip, ideas: [text], risk, questions: [{ tag, text, options: [..], default }], reply_to: { role, idea, stance, text } | null, replies_to: [{ role, idea, stance, text }], estimate: { size, low, high } | null }`
`replies_to` lists every `Re:` line; `reply_to` is its first entry or `null` (kept for the ideas and crossfire passes).

## Malformed (exit 1, `malformed: <reasons>`)
Missing `Risk:` (ideas and crossfire passes), more than 3 ideas, more than 2 questions, a question without options or with a default not among them, more `Re:` lines than the pass allows (or none in a non-skip full-pass reply), an unknown stance, `Re:` naming an idea ID that doesn't exist, an ideas-pass architect reply without `Estimate:`, any `Estimate:` in a full or crossfire pass, a non-architect `Estimate:`, any other line, too many words for the pass, or more than 4 KiB. Lines are matched with anchored linear patterns only.
Also malformed: an empty reply, any control character (tab and LF or CRLF line ends excepted; a lone CR counts), a line longer than 1000 characters, an empty `Re:` text or one over 25 words.
"Doesn't exist" for a `Re:` idea ID: its round is above the reply's round; and, when the file is known (`parse --file <file>`, and always in `apply`), the ID is not an idea in that file. `parse` without `--file` checks only the syntax and the round.

## Crossfire (debate rounds only, AC10)
`crossfire` picks one pair per round: the `challenge` reply-to on the idea with the most votes (ideas get a vote per `agree` or `build-on`), earliest on a tie; the pair is the challenger and the idea's author. Votes and challenges count every `Re:` line of the round's ideas pass and, in `debate: full_pass`, of its full pass too. Each pair member gets one extra dispatch with the other's replies and answers in the `crossfire` pass. No `challenge` this round → no crossfire.
Counting: a vote is a distinct (Role, idea) pair, so one Role counts once per idea across passes; only valid replies count; a challenge on the Role's own idea is ignored.
The style comes from `brainstorm.debate` (`aico-settings` v1.1, default `crossfire`):
- `crossfire`: ideas pass plus the crossfire pair; no full second pass.
- `full_pass`: ideas pass, then the full pass (every Role answers the others' ideas-pass replies), then the crossfire pair on top.
