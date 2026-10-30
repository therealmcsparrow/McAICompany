# `/aico:brainstorm`

`/aico:brainstorm <idea | file>`

## In short
**What it does.** Pitch an idea and the relevant Roles weigh in, round after round, until you say done — then you choose what happens to it.

**When to use it.** Early thinking: you have a direction, not a spec, and want the company's angles on it before committing.

**Help:** `/aico:brainstorm help` (or `--help`) explains the command without running it.

## How it works
1. The Lead picks the 4–8 Roles whose angle matters and opens a notes file in `.company/brainstorms/`.
2. **Rounds** in one of three modes — **ideas** (Roles answer in parallel, the default), **debate** (Roles respond to each other), **moderated** (one at a time). You can switch mode or add/drop Roles anytime. It runs until you say **done**.
   - Each Role gets one constant dispatch prompt for the whole run. What changes per round goes in a small input file for that Role in `.company/brainstorm-input/`, which the script writes and removes at Close. From round 2 it holds the questions already asked and answered (at most four of each), "Your last ideas" as plain lines with no IDs or labels, and one-line headlines under "Others said", each with its idea ID. The Role does not re-read the whole brainstorm file unless asked.
   - Replies are short: the Lead asks for at most 80 words in the ideas pass, 55 in a full pass and about 40 in a crossfire answer. A reply that copies an idea ID or a bullet in front of a label is still accepted and is not asked again. A Role that sees a question already answered does not ask it again; the Lead merges it into the answered one.
   - A Role may **skip** a round when it has nothing to add. That is recorded and is not an error.
   - **Debate** runs the ideas pass. In the default style, `crossfire`, the sharpest clash of the round is not a separate dispatch: the challenger's reply is quoted as dissent, and the challenged Role answers it in its next ideas pass, where it sees it under "Challenge to you". Set `brainstorm.debate` to `full_pass` in `/aico:settings` to keep the live crossfire pair (about 50 words each) and the full second pass, which reads more and saves nothing.
3. **After each round** you get a form. Open questions are merged, ranked (blocking first, then by votes) and never repeat an answered one. Each has options and a default, and the default is shown first as the recommended answer with a one-line reason (`brainstorm-reply` v2.0: a question without its reason is malformed); skip a question and the default is recorded as "CEO skipped". The form shows up to three questions, then Next, with a fourth shown as "up next". With no open question queued, the Lead says "No open questions" and asks only Next; it never pads the form to three. Unanswered defaults are assumed. A ruling you give that answers none of the asked questions is stored word for word as its own decision, linked to no question.
4. At the close, you choose: **plan and implement** (the main work of your type starts by itself from the notes, in a software company [`/aico:feature`](feature.md); if it cannot start, you are shown the command), **roadmap**, **nice to have**, or **park**. The file moves to the matching folder; `/aico:brainstorm "<file>"` reopens it later.

## Technical details
**You get.** `.company/brainstorms/YYYY-MM-DD HH.MM - Topic.md` (format 2) with `## Summary`, `## Digest`, `## Questions` and `## Rounds`. The digest quotes your answers word for word, lists open threads, keeps a dissent line in the dissenting Role's own words, and links each item to its round. Roles can reply to an idea (`@Role on I-2.1: agree | challenge | build-on`), and the replies show up as threads. With an Architect in the room, each round has an S/M/L estimate. Files from earlier versions open and continue as before; they are never rewritten. Builds nothing until you choose to.

**Film script.** Off by default. Turn on `brainstorm.film_script` in `/aico:settings` and the script writes a separate file, labelled as rendered from stored replies, where every line quotes a stored reply. No model is called and the brainstorm file is not changed.

**Personality.** Roles answer in their [personality](../concepts/personalities.md). It changes tone, word choice and how far the ideas reach, never facts, risks, verdicts or estimates.

**Example.** `/aico:brainstorm debate how should we onboard first-time users`
