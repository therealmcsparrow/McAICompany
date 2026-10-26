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
- `Skip` alone on the only line = nothing new this round (AC11). It is recorded in `## Rounds` and gets no Digest entry. Not an error.
- At most 150 words in total (crossfire replies: about 50).
- The Role gives no IDs; `apply` numbers ideas `I-<round>.<n>` across the round in roster order.

## Parse result (`parse` stdout)
`{ skip, ideas: [text], risk, questions: [{ tag, text, options: [..], default }], reply_to: { role, idea, stance, text } | null, estimate: { size, low, high } | null }`

## Malformed (exit 1, `malformed: <reasons>`)
Missing `Risk:`, more than 3 ideas, more than 2 questions, a question without options or with a default not among them, more than one `Re:` line, an unknown stance, `Re:` naming an idea ID that doesn't exist, an architect reply without `Estimate:`, a non-architect `Estimate:`, any other line, or more than 4 KiB. Lines are matched with anchored linear patterns only.

## Crossfire (debate mode only, AC10)
`crossfire` picks one pair per round: the `challenge` reply-to on the idea with the most votes (ideas get a vote per `agree` or `build-on`), earliest on a tie; the pair is the challenger and the idea's author. Each gets one extra dispatch with the other's reply and answers in about 50 words, same template minus `Estimate:`. No `challenge` this round → no crossfire. Debate mode no longer runs a full second pass.
