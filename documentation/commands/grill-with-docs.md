# `/aico:grill-with-docs`

`/aico:grill-with-docs <idea | file | resume <slug>>`

## In short
**Help:** `/aico:grill-with-docs help` (or `--help`) explains the command without running it.

**Only you start this command.** No other command or the Lead starts it. All four company types.

**What it does.** The same interview as [`/aico:grilling`](grilling.md), but the repo docs (`docs/`, `GLOSSARY.md`, `docs/adr/`) are searched first. A branch a doc closes cites that doc as `path:line`. A doc that disagrees with your answer is shown to you, not followed.

**When to use it.** Your product already has docs and decisions that should settle part of the idea.

## How it works
1. As `/aico:grilling`, reading repo docs only.
2. A branch a doc closes is logged with the doc and line; the rest is asked.

## Technical details
**You get.** `grill.md` with doc-cited facts and Proposals that carry glossary and ADR lines. It proposes and never writes those files.

**Your data.** Local files and the Claude model, as in grilling. No web search: only repo files are read.

**Example.** `/aico:grill-with-docs let customers pause their subscription`
