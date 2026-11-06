# `/aico:grill-me`

`/aico:grill-me <idea | file | resume <slug>>`

## In short
**Help:** `/aico:grill-me help` (or `--help`) explains the command without running it.

**Only you start this command.** No other command or the Lead starts it. All four company types.

**What it does.** The same interview as [`/aico:grill`](grill.md), but every branch is asked. Nothing is looked up in the repo or on the web, so the file has no fact entries.

**When to use it.** You want your own answers only, with no search of any kind.

## How it works
1. As `/aico:grill`, without lookups.
2. Every branch becomes a question for you; each answer is saved before the next.

## Technical details
**You get.** `grill.md` in `.company/work/<slug>/`.

**Your data.** Local files and the Claude model, as in the grill. No web search ever; no idea text or answer becomes a query.

**Example.** `/aico:grill-me let customers pause their subscription`
