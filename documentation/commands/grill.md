# `/aico:grill`

`/aico:grill <idea | file | resume <slug>>`

## In short
**Only you start this command.** No other command or the Lead starts it.

**What it does.** Interviews you about an idea, one question at a time, until the open branches are closed. Each question has two to four options and a recommended one. The Lead asks in the main session and looks facts up in your files; a fact it finds is logged with its source. Nothing is built.

**When to use it.** The idea is rough and you want its decisions made before a spec or a build. It works in all four company types.

**Help:** `/aico:grill help` (or `--help`) explains the command without running it.

## How it works
1. Takes your idea as typed, or a file you name, and lists the branches to settle.
2. Asks one question per branch, saves `.company/work/<slug>/grill.md` after every answer, and shows how many are answered and how many are open.
3. Stops when every branch is closed or when you stop it. `resume <slug>` or the path of an existing `grill.md` continues where it ended.
4. Ends with a form. In a software company you pick `/aico:to-spec` on the file (recommended), `/aico:feature` with the file, or Stop. In the other types it ends in the form of that type.

## Technical details
**You get.** `.company/work/<slug>/grill.md`: the idea, the decisions with your answers, and proposed glossary and ADR lines. grill proposes them and never writes them.

**Your data.** `grill.md` and the one-shot argument file `.company/draft-input-arg-<for>.txt` are local files that may hold what you type. The Claude model you configured reads them, and `grill` may run web searches built from your idea. See [Where your text goes](README.md#technical-details). The related commands are [`/aico:grilling`](grilling.md), [`/aico:grill-me`](grill-me.md) and [`/aico:grill-with-docs`](grill-with-docs.md).

**Example.** `/aico:grill let customers pause their subscription`
